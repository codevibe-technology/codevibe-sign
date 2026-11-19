import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { defaultPdfEngine } from './engine';
import { errorHandler, HttpError } from './errors';
import { redactPath } from './http/redact';
import type { SignServerOptions } from './options';
import { senderRoutes } from './routes/sender';
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
  const app = new Hono();

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
    if (c.req.path.startsWith('/v1/')) c.header('Cache-Control', 'no-store');
  });

  const tooLarge = () => {
    throw new HttpError('DOCUMENT_TOO_LARGE', 'The request body is too large');
  };
  app.use('/v1/envelopes/*', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  app.use('/v1/envelopes', bodyLimit({ maxSize: rt.limits.maxRequestBytes, onError: tooLarge }));
  app.use('/v1/sign/*', bodyLimit({ maxSize: SIGNER_BODY_LIMIT, onError: tooLarge }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/v1/envelopes', senderRoutes(rt));
  app.route('/v1/sign', signerRoutes(rt));

  return {
    app,
    tick: (tickOptions) => tick(rt, tickOptions),
    async idle() {
      while (rt.inflight.size > 0) await Promise.allSettled([...rt.inflight]);
    },
  };
}
