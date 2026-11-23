import { isIP } from 'node:net';
import { Hono, type MiddlewareHandler } from 'hono';
import { validation } from '../errors';
import { clientIp } from '../http/client';
import { enforce } from '../http/rate-limit';
import type { Runtime } from '../runtime/context';
import { verifySealedHash, verifySealedPdf } from '../verification';

const WINDOW_MS = 10 * 60 * 1000;

/**
 * What a client is counted by: its IPv4 address, or the /64 of its IPv6 address, since one
 * subscriber holds a whole /64 and could otherwise use a new address for every request.
 */
export function addressKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('%')[0]!.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/**
 * Counts a public verify request against its client address before anything is read from
 * it, so a client over its limit costs neither memory nor a parse. Callers whose address is
 * unknown share one larger allowance.
 */
export function verifyRateLimit(rt: Runtime): MiddlewareHandler {
  return async (c, next) => {
    const ip = clientIp(c, rt);
    const known = ip !== 'unknown';
    await enforce(
      rt.limiter,
      known ? `verify:ip:${addressKey(ip)}` : 'verify:shared',
      known ? rt.limits.verifyPer10Minutes : rt.limits.verifySharedPer10Minutes,
      WINDOW_MS,
      rt.clock.now(),
    );
    await next();
  };
}

/**
 * `POST /v1/verify` and `GET /v1/verify/:sha256`: is this a document this server sealed, and
 * is it unchanged? Public on purpose, like the certificate page inside every sealed file, so
 * anyone handed a document can check it. Limited per address by `verifyRateLimit`, and
 * nothing is stored.
 */
export function verifyRoutes(rt: Runtime) {
  const app = new Hono();

  app.post('/', async (c) => {
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

  app.get('/:sha256', async (c) => c.json(await verifySealedHash(rt, c.req.param('sha256'))));

  return app;
}
