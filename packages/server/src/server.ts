import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { defaultPdfEngine } from './engine';
import { errorHandler, HttpError } from './errors';
import { redactPath } from './http/redact';
import type { SignServerOptions } from './options';
import { senderRoutes } from './routes/sender';
import { linkRoutes } from './routes/link';
import { openApiRoutes } from './routes/openapi';
import { receiptRoutes } from './routes/receipt';
import { signerRoutes } from './routes/signer';
import { createRuntime } from './runtime/context';
import { tick, type TickOptions, type TickResult } from './runtime/tick';

const SIGNER_BODY_LIMIT = 10 * 1024 * 1024;

export interface SignServer {
  app: Hono;
  /** Sends due reminders, expires envelopes and retries failed jobs. Call it every minute or so. */
  tick(options?: TickOptions): Promise<TickResult>;
  /** Resolves when background effects started so far have finished. */
  idle(): Promise<void>;
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

  const tooLarge = () => {
    throw new HttpError('DOCUMENT_TOO_LARGE', 'The request body is too large');
  };
  app.use('/v1/envelopes/*', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  app.use('/v1/envelopes', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  app.use('/v1/sign/*', bodyLimit({ maxSize: SIGNER_BODY_LIMIT, onError: tooLarge }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/v1/openapi.json', openApiRoutes());
  app.route('/v1/envelopes', senderRoutes(rt));
  // Before the signer routes, whose `/:token` would otherwise take `receipt` for a token.
  app.route('/v1/sign/receipt', receiptRoutes(rt));
  app.route('/v1/sign', signerRoutes(rt));
  app.route('/sign', linkRoutes(rt));

  return {
    app,
    tick: (tickOptions) => tick(rt, tickOptions),
    async idle() {
      while (rt.inflight.size > 0) await Promise.allSettled([...rt.inflight]);
    },
  };
}
