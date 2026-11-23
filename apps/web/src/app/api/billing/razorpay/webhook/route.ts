import { enforceBillingLimit } from '@/server/billing/limits';
import { MAX_WEBHOOK_BYTES, handleRazorpayWebhook } from '@/server/billing/orders';
import { billingDeps } from '@/server/billing/runtime';
import { clientAddress } from '@/server/client-address';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { isHosted } from '@/server/plans';

export const dynamic = 'force-dynamic';

const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Reads at most `limit` bytes of the body; null when it is larger. */
async function readBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Razorpay's webhook. The raw body is checked against `X-Razorpay-Signature` before anything
 * in it is believed. A wrong signature answers 401; a delivery that was handled, seen before
 * or is of no interest answers 200 so it is not sent again.
 */
export async function POST(request: Request) {
  // A self-hosted install sells nothing, so it has no payment callbacks to take.
  if (!isHosted()) return answer(404, { ok: false });
  try {
    await enforceBillingLimit('webhooks', clientAddress(request.headers) ?? 'all');
  } catch {
    return answer(429, { ok: false });
  }
  const rawBody = await readBody(request, MAX_WEBHOOK_BYTES);
  if (rawBody === null) return answer(413, { ok: false });
  try {
    const outcome = await handleRazorpayWebhook(db(), billingDeps(), {
      rawBody,
      signature: request.headers.get('x-razorpay-signature'),
      eventId: request.headers.get('x-razorpay-event-id'),
    });
    return answer(200, { ok: true, outcome });
  } catch (err) {
    if (err instanceof AppError && err.code === 'UNAUTHORIZED') return answer(401, { ok: false });
    if (err instanceof AppError && err.code === 'NOT_FOUND') return answer(404, { ok: false });
    console.error('[billing] webhook', err instanceof Error ? err.message : err);
    return answer(500, { ok: false });
  }
}
