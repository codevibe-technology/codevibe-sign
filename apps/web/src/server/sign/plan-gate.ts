import 'server-only';
import type { Principal } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import type { PlanSettings } from '@/lib/plans';
import { AppError } from '../errors';
import { routedParam, routedPath } from './route-path';
import {
  PlanLimitError,
  assertWithin,
  releaseStorage,
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
  /**
   * The size of each PDF of a template, or null when the workspace has no such template. An
   * envelope made from it stores a copy of each.
   */
  templateSizes?: (workspaceId: string, templateId: string) => Promise<number[] | null>;
  /**
   * The stored size of each document of an envelope, or null when the workspace has no such
   * envelope. Replacing a draft's PDF and copying an envelope to a new draft are counted
   * against these.
   */
  documentSizes?: (
    workspaceId: string,
    envelopeId: string,
  ) => Promise<{ id: string; bytes: number }[] | null>;
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

const malformedPath = () =>
  new Response(
    JSON.stringify({ error: { code: 'VALIDATION', message: 'The address is not valid' } }),
    { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );

/** 429 with `Retry-After` for a count that starts again by itself, 403 for the rest. */
const planLimitResponse = (err: PlanLimitError, now: Date) => {
  const retry = err.status === 429 ? err.retryAfterSeconds(now) : null;
  return new Response(JSON.stringify(err.toJSON()), {
    status: err.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(retry !== null ? { 'retry-after': String(retry) } : {}),
    },
  });
};

/**
 * The path the gate matches on: escapes decoded as the router decodes them, and repeated
 * slashes folded, so no spelling of a counted route reads as a different one here.
 */
function gatedPath(url: string): string | null {
  const path = routedPath(url);
  return path === null ? null : path.replace(/\/{2,}/g, '/');
}

/**
 * Applies the workspace's plan to calls of the sign API, at the one place every call passes:
 * browser and API-key requests through the route handlers, and the app's own in-process calls.
 * It counts API-key requests by the month and the day, refuses PDFs larger than the plan takes,
 * and reserves the storage and the monthly send before the server does the work, giving them
 * back if the server then refuses. That covers a new envelope, one made from a template, a
 * draft being sent, a draft's PDF being replaced and an envelope copied to a new draft.
 * Self-hosted installs skip it entirely.
 */
export function createPlanGate(deps: PlanGateDeps) {
  const prefix = `${deps.basePath}/v1/`;
  const now = deps.now ?? (() => new Date());

  return async (request: Request, forward: Forward): Promise<Response> => {
    const settings = deps.settings();
    if (settings.mode === 'self-hosted') return forward(request);
    const path = gatedPath(request.url);
    if (path === null) return malformedPath();
    if (!path.startsWith(prefix) || path.startsWith(`${prefix}sign/`)) return forward(request);
    const route = path.slice(deps.basePath.length);
    const creating = request.method === 'POST' && /^\/v1\/envelopes\/?$/.test(route);
    const sending =
      request.method === 'POST' ? /^\/v1\/envelopes\/([^/]+)\/send\/?$/.exec(route) : null;
    const fromTemplate =
      request.method === 'POST' ? /^\/v1\/templates\/([^/]+)\/envelopes\/?$/.exec(route) : null;
    const replacing =
      request.method === 'PUT'
        ? /^\/v1\/envelopes\/([^/]+)\/documents\/([^/]+)\/?$/.exec(route)
        : null;
    const copying =
      request.method === 'POST'
        ? /^\/v1\/envelopes\/([^/]+)\/(?:recall|revise)\/?$/.exec(route)
        : null;
    const keyCall = /^Bearer\s/i.test(request.headers.get('authorization') ?? '');
    const counted = creating || sending || fromTemplate || replacing || copying;
    if (!counted && !keyCall) return forward(request);

    const principal = await deps.authenticate(request).catch(() => null);
    if (!principal?.workspaceId) return forward(request);
    // Only a workspace that does not exist goes on unchecked (the server answers 404); any
    // other failure to read the plan stops the request rather than letting it through.
    const found = await workspacePlan(deps.sql, principal.workspaceId, settings).catch(
      (err: unknown) => {
        if (err instanceof AppError && err.code === 'NOT_FOUND') return null;
        throw err;
      },
    );
    if (!found) return forward(request);
    const plan = { id: principal.workspaceId, ...found };
    const at = now();
    const held: Reservation[] = [];
    let freed = 0;

    try {
      // Every call made with a key counts, whatever the server then answers; a call refused
      // here for the count itself does not.
      if (keyCall && !principal.id.startsWith('user:')) {
        const month = await reserveUsage(deps.sql, plan, 'api_requests_month', 1, at);
        try {
          await reserveUsage(deps.sql, plan, 'api_requests', 1, at);
        } catch (err) {
          await releaseUsage(deps.sql, month);
          throw err;
        }
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
      if (fromTemplate) {
        const templateId = routedParam(fromTemplate[1]!);
        const sizes = templateId ? await deps.templateSizes?.(plan.id, templateId) : null;
        const body = sizes ? await readSendFlag(request, deps.maxBodyBytes) : null;
        if (sizes && body) {
          const total = sizes.reduce((a, b) => a + b, 0);
          const storage = await reserveUsage(deps.sql, plan, 'storage_bytes', total, at);
          if (storage) held.push(storage);
          if (body.send) {
            const sent = await reserveUsage(deps.sql, plan, 'envelopes_sent', 1, at);
            if (sent) held.push(sent);
          }
        }
      }
      if (sending) {
        const envelopeId = routedParam(sending[1]!);
        const sample =
          envelopeId !== null && ((await deps.isSampleEnvelope?.(plan.id, envelopeId)) ?? false);
        if (!sample) {
          const sent = await reserveUsage(deps.sql, plan, 'envelopes_sent', 1, at);
          if (sent) held.push(sent);
        }
      }
      if (replacing) {
        const envelopeId = routedParam(replacing[1]!);
        const documentId = routedParam(replacing[2]!);
        const sizes = envelopeId ? await deps.documentSizes?.(plan.id, envelopeId) : null;
        const size = sizes ? await readReplacementSize(request, deps.maxBodyBytes) : null;
        const current = sizes?.find((d) => d.id === documentId);
        if (sizes && size !== null && current) {
          assertWithin(plan, 'fileBytes', size, 'document');
          const others = sizes.reduce((a, d) => a + (d.id === current.id ? 0 : d.bytes), 0);
          assertWithin(plan, 'envelopeBytes', others + size, 'document');
          const growth = size - current.bytes;
          if (growth > 0) {
            const storage = await reserveUsage(deps.sql, plan, 'storage_bytes', growth, at);
            if (storage) held.push(storage);
          } else {
            freed = -growth;
          }
        }
      }
      if (copying) {
        const envelopeId = routedParam(copying[1]!);
        const sizes = envelopeId ? await deps.documentSizes?.(plan.id, envelopeId) : null;
        if (sizes) {
          const total = sizes.reduce((a, d) => a + d.bytes, 0);
          const storage = await reserveUsage(deps.sql, plan, 'storage_bytes', total, at);
          if (storage) held.push(storage);
        }
      }
    } catch (err) {
      await Promise.all(held.map((r) => releaseUsage(deps.sql, r)));
      if (err instanceof PlanLimitError) return planLimitResponse(err, at);
      throw err;
    }

    let response: Response;
    try {
      response = await forward(request);
    } catch (err) {
      await Promise.all(held.map((r) => releaseUsage(deps.sql, r)));
      throw err;
    }
    // A replayed answer is the first request's, which was already counted.
    const replayed = response.headers.get('idempotent-replayed') === 'true';
    if (!response.ok || replayed) await Promise.all(held.map((r) => releaseUsage(deps.sql, r)));
    else if (freed > 0) await releaseStorage(deps.sql, plan.id, freed);
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

/** Whether a JSON request asks to send, read from a copy of the body; null when unreadable. */
async function readSendFlag(request: Request, cap: number): Promise<{ send: boolean } | null> {
  const bytes = await readCapped(request, cap);
  if (!bytes) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { send?: unknown } | null;
    return { send: body?.send === true };
  } catch {
    return null;
  }
}

/**
 * The size of the PDF a replace request carries, read from a copy of the body: the multipart
 * `document` file, or JSON `content` in base64. Null when the body cannot be read.
 */
export async function readReplacementSize(request: Request, cap: number): Promise<number | null> {
  const bytes = await readCapped(request, cap);
  if (!bytes) return null;
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.startsWith('multipart/form-data')) {
      const form = await new Response(bytes as BlobPart, {
        headers: { 'content-type': type },
      }).formData();
      const file = form.get('document');
      return file !== null && typeof file !== 'string' ? file.size : null;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { content?: unknown } | null;
    return typeof body?.content === 'string' ? base64Bytes(body.content) : null;
  } catch {
    return null;
  }
}
