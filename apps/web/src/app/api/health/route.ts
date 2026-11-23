import { billingConfig, billingMode } from '@/server/billing/config';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * Which accounts the payment and eSign keys belong to, so an operator can check a change of
 * keys from outside. Modes and plain-language problems only; a key is never part of it.
 */
function billing() {
  try {
    return billingMode(billingConfig());
  } catch (err) {
    return {
      razorpay: null,
      leegality: null,
      live: false,
      problems: [err instanceof Error ? err.message : 'The billing settings could not be read.'],
    };
  }
}

export async function GET() {
  try {
    await db()`select 1`;
    return Response.json({ ok: true, billing: billing() });
  } catch {
    return Response.json({ ok: false, error: 'database unavailable' }, { status: 503 });
  }
}
