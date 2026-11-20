import { SIGNATURE_HEADER } from '@codevibe_technology/sign-server';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * A receiver for trying webhooks without running your own server: point an endpoint at
 * /api/webhooks/test and every delivery is accepted and answered, so the delivery log shows
 * it as delivered. Nothing is stored, and the signature is not checked because the secret
 * is known only to the workspace.
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) {
    return Response.json({ received: false, error: 'body too large' }, { status: 413 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return Response.json({ received: false, error: 'body too large' }, { status: 413 });
  }
  let event: string | null = null;
  try {
    const body = JSON.parse(text) as { type?: unknown; event?: unknown };
    const name = body.type ?? body.event;
    event = typeof name === 'string' ? name : null;
  } catch {
    return Response.json({ received: false, error: 'body is not JSON' }, { status: 400 });
  }
  return Response.json({
    received: true,
    event,
    signed: request.headers.has(SIGNATURE_HEADER),
    bytes: text.length,
  });
}

export function GET() {
  return Response.json({
    receiver: 'Codevibe Sign test webhook receiver',
    usage:
      'Add https://<this host>/api/webhooks/test as a webhook endpoint to see deliveries succeed.',
  });
}
