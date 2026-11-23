import { Hono, type Context } from 'hono';
import { validation } from '../errors';
import { clientIp } from '../http/client';
import { enforce } from '../http/rate-limit';
import type { Runtime } from '../runtime/context';
import { verifySealedHash, verifySealedPdf } from '../verification';

const WINDOW_MS = 10 * 60 * 1000;

/**
 * `POST /v1/verify` and `GET /v1/verify/:sha256`: is this a document this server sealed, and
 * is it unchanged? Public on purpose, like the certificate page inside every sealed file, so
 * anyone handed a document can check it. Limited per address, and nothing is stored.
 */
export function verifyRoutes(rt: Runtime) {
  const app = new Hono();

  const limit = async (c: Context) => {
    const ip = clientIp(c, rt);
    const known = ip !== 'unknown';
    await enforce(
      rt.limiter,
      known ? `verify:ip:${ip}` : 'verify:shared',
      known ? rt.limits.verifyPer10Minutes : rt.limits.verifySharedPer10Minutes,
      WINDOW_MS,
      rt.clock.now(),
    );
  };

  app.post('/', async (c) => {
    await limit(c);
    const type = c.req.header('content-type') ?? '';
    let bytes: Uint8Array;
    if (type.startsWith('multipart/form-data')) {
      const file = (await c.req.parseBody()).file;
      if (!(file instanceof File)) {
        throw validation('Attach the PDF in a form field named "file"', { field: 'file' });
      }
      bytes = new Uint8Array(await file.arrayBuffer());
    } else if (type.startsWith('application/pdf') || type.startsWith('application/octet-stream')) {
      bytes = new Uint8Array(await c.req.arrayBuffer());
    } else {
      throw validation(
        'Send the PDF as multipart/form-data in a field named "file", or as an application/pdf body',
      );
    }
    return c.json(await verifySealedPdf(rt, bytes));
  });

  app.get('/:sha256', async (c) => {
    await limit(c);
    return c.json(await verifySealedHash(rt, c.req.param('sha256')));
  });

  return app;
}
