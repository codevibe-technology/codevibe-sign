import type { AuditAction, Envelope } from '@codevibe_technology/sign-core';
import { constantTimeEqual, hmacSha256Hex } from '../crypto';
import type { WebhookTarget } from '../options';
import { DEFAULT_WORKSPACE } from '../tenancy';
import type { Runtime } from './context';
import { checkWebhookUrl, pinnedPost, resolveWebhookAddress } from './webhook-guard';

export const SIGNATURE_HEADER = 'x-codevibe-signature';
const CONNECT_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface WebhookPayload {
  url: string;
  /** Missing on jobs queued before workspaces: those belong to the default workspace. */
  workspaceId?: string;
  deliveryId: string;
  body: string;
}

/** The body is frozen when the event happens, so retries deliver the same bytes. */
export function buildWebhookBody(
  deliveryId: string,
  event: AuditAction,
  envelope: Envelope,
  now: Date,
): string {
  return JSON.stringify({
    id: deliveryId,
    type: event,
    createdAt: now.toISOString(),
    data: {
      envelope: {
        id: envelope.id,
        title: envelope.title,
        status: envelope.status,
        metadata: envelope.metadata ?? {},
        completedAt: envelope.completedAt ?? null,
        recipients: envelope.recipients.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email ?? null,
          role: r.role,
          status: r.status,
          actedAt: r.actedAt ?? null,
        })),
      },
    },
  });
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/**
 * Checks a delivery on the receiving side. Rejects signatures older than `toleranceSeconds`
 * to stop replays.
 */
export function verifyWebhook(
  secret: string,
  header: string | null | undefined,
  body: string,
  options: { now?: Date; toleranceSeconds?: number } = {},
): boolean {
  if (!header) return false;
  const parts = new Map(
    header.split(',').map((part) => {
      const at = part.indexOf('=');
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!Number.isInteger(t) || !v1) return false;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - t) > (options.toleranceSeconds ?? 300)) return false;
  return constantTimeEqual(v1, hmacSha256Hex(secret, `${t}.${body}`));
}

/**
 * Targets that receive a workspace's events: the static `webhooks` for the default workspace,
 * plus whatever `webhookTargets` returns for it.
 */
export async function webhookTargetsFor(
  rt: Runtime,
  workspaceId: string,
): Promise<WebhookTarget[]> {
  const fixed = workspaceId === DEFAULT_WORKSPACE ? rt.webhooks : [];
  const own = rt.webhookTargets ? await rt.webhookTargets(workspaceId) : [];
  return [...fixed, ...own];
}

export async function deliverWebhook(rt: Runtime, payload: WebhookPayload): Promise<void> {
  const targets = await webhookTargetsFor(rt, payload.workspaceId ?? DEFAULT_WORKSPACE);
  const target = targets.find((w) => w.url === payload.url);
  if (!target) return;
  if (target.secret.length < 16) throw new Error(`Webhook secret for ${target.url} is too short`);
  const url = checkWebhookUrl(payload.url, rt.webhookSecurity);
  const address = await resolveWebhookAddress(url, rt.webhookSecurity);
  const timestamp = Math.floor(rt.clock.now().getTime() / 1000);
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'codevibe-sign-webhooks',
    'x-codevibe-delivery': payload.deliveryId,
    [SIGNATURE_HEADER]: signWebhook(target.secret, payload.body, timestamp),
  };
  let status: number;
  if (rt.fetch) {
    const response = await rt.fetch(payload.url, {
      method: 'POST',
      headers,
      body: payload.body,
      signal: AbortSignal.timeout(TOTAL_TIMEOUT_MS),
      redirect: 'manual',
    });
    status = response.status;
    await response.body?.cancel().catch(() => undefined);
  } else {
    status = await pinnedPost({
      url,
      address,
      headers,
      body: payload.body,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Webhook ${url.host} answered ${status}`);
  }
}
