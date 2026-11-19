import { hashToken, isSigningTokenShape } from '@codevibe_technology/sign-core';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { clientIp } from '../http/client';
import { enforce } from '../http/rate-limit';
import { LINK_COOKIE, LINK_COOKIE_MAX_MS } from '../http/session';
import type { Runtime } from '../runtime/context';
import { activeSigner } from './signer';

const COOKIE_PATH = '/v1/sign';

/**
 * `GET /sign/:token`, where signing links point. It swaps the token for an HttpOnly,
 * SameSite=Strict cookie and redirects to the signing page, whose URL carries no token, so the
 * token stays out of browser history, `Referer` headers and the page's access logs. It only
 * reads: mail scanners that open links before the recipient do change nothing, and the
 * recipient is marked as having viewed the document only when the page posts `/view`.
 */
export function linkRoutes(rt: Runtime) {
  const app = new Hono();

  app.get('/:token', async (c) => {
    const now = rt.clock.now();
    await enforce(rt.limiter, `ip:${clientIp(c, rt)}`, rt.limits.ipRequestsPerMinute, 60_000, now);
    const token = c.req.param('token');
    const active = isSigningTokenShape(token)
      ? await activeSigner(rt, hashToken(token), now)
      : null;
    if (active) {
      const remaining = Math.min(active.expiresAt.getTime() - now.getTime(), LINK_COOKIE_MAX_MS);
      setCookie(c, LINK_COOKIE, token, {
        httpOnly: true,
        secure: rt.secureCookies,
        sameSite: 'Strict',
        path: COOKIE_PATH,
        maxAge: Math.max(1, Math.floor(remaining / 1000)),
      });
    } else {
      deleteCookie(c, LINK_COOKIE, { path: COOKIE_PATH, secure: rt.secureCookies });
    }
    c.header('Cache-Control', 'no-store');
    return c.redirect(rt.signingPageUrl, 303);
  });

  return app;
}
