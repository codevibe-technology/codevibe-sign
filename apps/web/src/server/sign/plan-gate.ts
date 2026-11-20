import 'server-only';
import type { Principal } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import type { PlanSettings } from '@/lib/plans';
import {
  PlanLimitError,
  assertWithin,
  releaseUsage,
  reserveUsage,
  workspacePlan,
  type Reservation,
} from '../plans';

export interface PlanGateDeps {
  sql: postgres.Sql;
  settings: () => PlanSettings;
  /** The same resolver the sign server uses, so the gate counts for the caller it will serve. */
  authenticate: (request: Request) => Promise<Principal | null>;
  /** The first-run sample envelope, whose sending does not count. */
  isSampleEnvelope?: (workspaceId: string, envelopeId: string) => Promise<boolean>;
  basePath: string;
  /** Bodies larger than this are left to the sign server, which refuses them. */
  maxBodyBytes: number;
  now?: () => Date;
}

type Forward = (request: Request) => Promise<Response>;

interface CreateBody {
  send: boolean;
  sizes: number[];
}

const planLimitResponse = (err: PlanLimitError) =>
  new Response(JSON.stringify(err.toJSON()), {
    status: 403,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Applies the workspace's plan to calls of the sign API, at the one place every call passes:
 * browser and API-key requests through the route handlers, and the app's own in-process calls.
 * It counts API-key requests per day, refuses PDFs larger than the plan takes, and reserves
 * the storage and the monthly send before the server does the work, giving them back if the
 * server then refuses. Self-hosted installs skip it entirely.
 */
export function createPlanGate(deps: PlanGateDeps) {
  const prefix = `${deps.basePath}/v1/`;
  const now = deps.now ?? (() => new Date());

  return async (request: Request, forward: Forward): Promise<Response> => {
    const settings = deps.settings();
    if (settings.mode === 'self-hosted') return forward(request);
    const path = new URL(request.url).pathname;
    if (!path.startsWith(prefix) || path.startsWith(`${prefix}sign/`)) return forward(request);
    const route = path.slice(deps.basePath.length);
    const creating = request.method === 'POST' && /^\/v1\/envelopes\/?$/.test(route);
    const sending =
      request.method === 'POST' ? /^\/v1\/envelopes\/([^/]+)\/send\/?$/.exec(route) : null;
    const keyCall = /^Bearer\s/i.test(request.headers.get('authorization') ?? '');
    if (!creating && !sending && !keyCall) return forward(request);

    const principal = await deps.authenticate(request).catch(() => null);
    if (!principal?.workspaceId) return forward(request);
    const found = await workspacePlan(deps.sql, principal.workspaceId, settings).catch(() => null);
    if (!found) return forward(request);
    const plan = { id: principal.workspaceId, ...found };
    const at = now();
    const held: Reservation[] = [];

    try {
      if (keyCall && !principal.id.startsWith('user:')) {
        await reserveUsage(deps.sql, plan, 'api_requests', 1, at);
      }
      if (creating) {
        const body = await readCreateBody(request, deps.maxBodyBytes);
        if (body) {
          body.sizes.forEach((size, i) => assertWithin(plan, 'fileBytes', size, `documents[${i}]`));
          const total = body.sizes.reduce((a, b) => a + b, 0);
          assertWithin(plan, 'envelopeBytes', total, 'documents');
          const storage = await reserveUsage(deps.sql, plan, 'storage_bytes', total, at);
          if (storage) held.push(storage);
          if (body.send) {
            const sent = await reserveUsage(deps.sql, plan, 'envelopes_sent', 1, at);
            if (sent) held.push(sent);
          }
        }
      }
      if (sending) {
        const envelopeId = decodeURIComponent(sending[1]!);
        const sample = (await deps.isSampleEnvelope?.(plan.id, envelopeId)) ?? false;
        if (!sample) {
          const sent = await reserveUsage(deps.sql, plan, 'envelopes_sent', 1, at);
          if (sent) held.push(sent);
        }
      }
    } catch (err) {
      await Promise.all(held.map((r) => releaseUsage(deps.sql, r)));
      if (err instanceof PlanLimitError) return planLimitResponse(err);
      throw err;
    }

    let response: Response;
    try {
      response = await forward(request);
    } catch (err) {
      await Promise.all(held.map((r) => releaseUsage(deps.sql, r)));
      throw err;
    }
    if (!response.ok) await Promise.all(held.map((r) => releaseUsage(deps.sql, r)));
    return response;
  };
}

/** Bytes a base64 string decodes to. */
export const base64Bytes = (content: string) => {
  const clean = content.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
};

async function readCapped(request: Request, cap: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) return null;
  const reader = request.clone().body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > cap) {
      // Not awaited: a cancelled copy of a body settles only once the original is read too.
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Whether a create request asks to send, and the size of each PDF, read from a copy of the
 * body. Null when the body cannot be read; the sign server then refuses it with its own error.
 */
export async function readCreateBody(request: Request, cap: number): Promise<CreateBody | null> {
  const bytes = await readCapped(request, cap);
  if (!bytes) return null;
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.startsWith('multipart/form-data')) {
      const form = await new Response(bytes as BlobPart, {
        headers: { 'content-type': type },
      }).formData();
      const raw = form.get('envelope');
      const envelope = typeof raw === 'string' ? (JSON.parse(raw) as { send?: unknown }) : {};
      const sizes = form
        .getAll('documents')
        .filter((f): f is File => typeof f !== 'string')
        .map((f) => f.size);
      return { send: envelope.send === true, sizes };
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as {
      send?: unknown;
      documents?: unknown;
    };
    const documents = Array.isArray(body.documents) ? body.documents : [];
    const sizes = documents.map((doc: unknown) => {
      const content = (doc as { content?: unknown } | null)?.content;
      return typeof content === 'string' ? base64Bytes(content) : 0;
    });
    return { send: body.send === true, sizes };
  } catch {
    return null;
  }
}
