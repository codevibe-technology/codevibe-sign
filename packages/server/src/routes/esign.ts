import { leegalityWebhookRef } from '@codevibe_technology/sign-aadhaar';
import { SignError } from '@codevibe_technology/sign-core';
import { Hono } from 'hono';
import { HttpError } from '../errors';
import { applyEsignEvent, sessionProvider } from '../esign/flow';
import { clientIp } from '../http/client';
import { enforce } from '../http/rate-limit';
import type { Runtime } from '../runtime/context';

/** Provider callbacks are small JSON documents. */
export const ESIGN_WEBHOOK_MAX_BYTES = 256 * 1024;

const PROVIDER_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const unknown = () => new HttpError('NOT_FOUND', 'Not found');
const refused = () => new HttpError('UNAUTHORIZED', 'The webhook could not be verified');

/**
 * `POST /v1/esign/webhooks/:provider`: where an eSign provider reports what became of a
 * signing request. The body names the request; its session names the workspace, and that
 * workspace's provider credentials verify the body before anything is done with it. A
 * callback for one workspace can therefore never pass with another workspace's secret.
 */
export function esignWebhookRoutes(rt: Runtime) {
  const app = new Hono();

  app.post('/:provider', async (c) => {
    await enforce(
      rt.limiter,
      `esign-webhook-ip:${clientIp(c, rt)}`,
      rt.limits.ipRequestsPerMinute,
      60_000,
      rt.clock.now(),
    );
    const name = c.req.param('provider');
    const store = rt.store.esign;
    if (!rt.esign || !store || !PROVIDER_NAME.test(name)) throw unknown();

    const raw = await c.req.text();
    const ref =
      rt.esign.webhookRef?.(name, raw) ?? (name === 'leegality' ? leegalityWebhookRef(raw) : null);
    const session = ref ? await store.findByRef(name, ref) : null;
    if (!session) throw unknown();
    const provider = await sessionProvider(rt, session);
    if (!provider || provider.name !== name) throw unknown();

    let event;
    try {
      event = await provider.parseWebhook(c.req.raw.headers, raw);
    } catch (err) {
      if (err instanceof SignError && err.code === 'WEBHOOK_INVALID') throw refused();
      throw err;
    }
    if (event && event.providerRef !== session.providerRef) throw refused();
    if (event) await applyEsignEvent(rt, session, event);
    return c.json({ ok: true });
  });

  return app;
}
