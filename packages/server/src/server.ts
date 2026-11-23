import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { defaultPdfEngine } from './engine';
import { errorHandler, HttpError } from './errors';
import { redactPath } from './http/redact';
import { versioning } from './http/versioning';
import type { SignServerOptions, WebhookDeliveryReport } from './options';
import { senderRoutes } from './routes/sender';
import { linkRoutes } from './routes/link';
import { openApiRoutes } from './routes/openapi';
import { copyRoutes } from './routes/copy';
import { ESIGN_WEBHOOK_MAX_BYTES, esignWebhookRoutes } from './routes/esign';
import { receiptRoutes } from './routes/receipt';
import { signerRoutes } from './routes/signer';
import { templateRoutes } from './routes/templates';
import { verifyRateLimit, verifyRoutes } from './routes/verify';
import { createRuntime } from './runtime/context';
import { tick, type TickOptions, type TickResult } from './runtime/tick';
import { verifySealedPdf, type PublicVerification } from './verification';
import {
  attemptWebhook,
  buildTestWebhookBody,
  reportWebhook,
  type WebhookPayload,
} from './runtime/webhooks';

const SIGNER_BODY_LIMIT = 10 * 1024 * 1024;
/** Room for the multipart boundaries and headers around an uploaded PDF. */
const VERIFY_FORM_OVERHEAD = 64 * 1024;

export interface SignServer {
  app: Hono;
  /** Sends due reminders, expires envelopes and retries failed jobs. Call it every minute or so. */
  tick(options?: TickOptions): Promise<TickResult>;
  /** Resolves when background effects started so far have finished. */
  idle(): Promise<void>;
  /**
   * Posts a `webhook.test` event to one of the workspace's targets now and says how it went.
   * Nothing is queued: a failed test is not retried. The report also goes to
   * `onWebhookDelivery`.
   */
  sendTestWebhook(input: { workspaceId: string; url: string }): Promise<WebhookDeliveryReport>;
  /**
   * Posts an earlier delivery again now, with the same id and body, for example after the
   * receiver was fixed. The target is looked up again, so its current secret signs it.
   */
  redeliverWebhook(input: {
    workspaceId: string;
    url: string;
    deliveryId: string;
    body: string;
  }): Promise<WebhookDeliveryReport>;
  /**
   * What `POST /v1/verify` answers for these bytes, for a page of your own that checks sealed
   * files. Apply your own rate limit before calling it; nothing is stored.
   */
  verifyPdf(bytes: Uint8Array): Promise<PublicVerification>;
}

export function createSignServer(options: SignServerOptions): SignServer {
  const rt = createRuntime(options, options.pdf ?? defaultPdfEngine);
  const app = rt.basePath ? new Hono().basePath(rt.basePath) : new Hono();
  const apiPrefix = `${rt.basePath}/v1/`;

  app.onError(errorHandler(rt.logger));
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));

  if (options.accessLog) {
    app.use('*', async (c, next) => {
      const started = Date.now();
      await next();
      rt.logger.info?.('request', {
        method: c.req.method,
        path: redactPath(c.req.path),
        status: c.res.status,
        ms: Date.now() - started,
      });
    });
  }

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.req.path.startsWith(apiPrefix) && !c.res.headers.has('cache-control')) {
      c.header('Cache-Control', 'no-store');
    }
  });

  app.use('*', versioning(rt.basePath));

  const tooLarge = () => {
    throw new HttpError('DOCUMENT_TOO_LARGE', 'The request body is too large');
  };
  app.use('/v1/envelopes/*', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  app.use('/v1/envelopes', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  app.use('/v1/templates/*', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  app.use('/v1/templates', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  // Before the size check, which reads a body sent without a length to measure it.
  // The wildcard covers `/v1/verify` itself too; a second entry would count a request twice.
  app.use('/v1/verify/*', verifyRateLimit(rt));
  app.use(
    '/v1/verify',
    bodyLimit({ maxSize: rt.limits.maxPdfBytes + VERIFY_FORM_OVERHEAD, onError: tooLarge }),
  );
  app.use('/v1/sign/*', bodyLimit({ maxSize: SIGNER_BODY_LIMIT, onError: tooLarge }));
  app.use('/v1/esign/*', bodyLimit({ maxSize: ESIGN_WEBHOOK_MAX_BYTES, onError: tooLarge }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/v1/openapi.json', openApiRoutes());
  app.route('/v1/envelopes', senderRoutes(rt));
  app.route('/v1/templates', templateRoutes(rt));
  app.route('/v1/verify', verifyRoutes(rt));
  // Before the signer routes, whose `/:token` would otherwise take `receipt` for a token.
  app.route('/v1/sign/receipt', receiptRoutes(rt));
  app.route('/v1/sign/copy', copyRoutes(rt));
  app.route('/v1/sign', signerRoutes(rt));
  app.route('/v1/esign/webhooks', esignWebhookRoutes(rt));
  app.route('/sign', linkRoutes(rt));

  const deliverNow = async (payload: WebhookPayload) => {
    const { report } = await attemptWebhook(rt, payload, 1, null);
    await reportWebhook(rt, report);
    return report;
  };

  return {
    app,
    tick: (tickOptions) => tick(rt, tickOptions),
    sendTestWebhook({ workspaceId, url }) {
      const deliveryId = rt.ids.id();
      const body = buildTestWebhookBody(deliveryId, rt.clock.now());
      return deliverNow({ url, workspaceId, deliveryId, body });
    },
    redeliverWebhook: ({ workspaceId, url, deliveryId, body }) =>
      deliverNow({ url, workspaceId, deliveryId, body }),
    verifyPdf: (bytes) => verifySealedPdf(rt, bytes),
    async idle() {
      while (rt.inflight.size > 0) await Promise.allSettled([...rt.inflight]);
    },
  };
}
