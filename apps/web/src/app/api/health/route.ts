import { billingConfig, billingMode } from '@/server/billing/config';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * Which accounts the payment and eSign keys belong to, so an operator can check a change of
 * keys from outside. This answer is public, so problems are short codes only: which setting
 * is wrong, and why, is written to the server log (`[billing]` lines), never here.
 */
function billing() {
  try {
    const mode = billingMode(billingConfig());
    return {
      razorpay: mode.razorpay,
      leegality: mode.leegality,
      live: mode.live,
      problems: [
        ...(mode.live && mode.razorpay === 'test' ? ['test_payment_key_while_live'] : []),
        ...(mode.live && mode.leegality === 'sandbox' ? ['sandbox_esign_while_live'] : []),
      ],
    };
  } catch {
    return { razorpay: null, leegality: null, live: false, problems: ['settings_invalid'] };
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
