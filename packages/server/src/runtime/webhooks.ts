import type { AuditAction, Envelope } from '@codevibe/sign-core';
import { constantTimeEqual, hmacSha256Hex } from '../crypto';
import type { Runtime } from './context';

export const SIGNATURE_HEADER = 'x-codevibe-signature';
const TIMEOUT_MS = 10_000;

export interface WebhookPayload {
  url: string;
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

export async function deliverWebhook(rt: Runtime, payload: WebhookPayload): Promise<void> {
  const target = rt.webhooks.find((w) => w.url === payload.url);
  if (!target) return;
  const timestamp = Math.floor(rt.clock.now().getTime() / 1000);
  const response = await rt.fetch(payload.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'codevibe-sign-webhooks',
      'x-codevibe-delivery': payload.deliveryId,
      [SIGNATURE_HEADER]: signWebhook(target.secret, payload.body, timestamp),
    },
    body: payload.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'manual',
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook ${payload.url} answered ${response.status}`);
  }
}
