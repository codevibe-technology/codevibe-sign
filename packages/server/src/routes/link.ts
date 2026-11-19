import { hashToken, isSigningTokenShape } from '@codevibe_technology/sign-core';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { clientIp } from '../http/client';
import { enforce } from '../http/rate-limit';
import { LINK_COOKIE, LINK_COOKIE_MAX_MS } from '../http/session';
import type { Runtime } from '../runtime/context';
import { activeSigner, linkState, signerCookiePath } from './signer';

/**
 * `GET /sign/:token`, where signing links point. It swaps the token for an HttpOnly,
 * SameSite=Strict cookie and redirects to the signing page, whose URL carries no token, so the
 * token stays out of browser history, `Referer` headers and the page's access logs. It only
 * reads: mail scanners that open links before the recipient do change nothing, and the
 * recipient is marked as having viewed the document only when the page posts `/view`.
 *
 * A link that no longer works still redirects, with `?state=` saying why (signed, completed,
 * declined, voided, expired or invalid) and `&w=` naming the workspace, so the page can explain
 * it in the sender's brand.
 */
export function linkRoutes(rt: Runtime) {
  const app = new Hono();
  const cookiePath = signerCookiePath(rt);

  app.get('/:token', async (c) => {
    const now = rt.clock.now();
    await enforce(rt.limiter, `ip:${clientIp(c, rt)}`, rt.limits.ipRequestsPerMinute, 60_000, now);
    const token = c.req.param('token');
    const tokenHash = isSigningTokenShape(token) ? hashToken(token) : null;
    const active = tokenHash ? await activeSigner(rt, tokenHash, now) : null;
    c.header('Cache-Control', 'no-store');
    if (active) {
      const remaining = Math.min(active.expiresAt.getTime() - now.getTime(), LINK_COOKIE_MAX_MS);
      setCookie(c, LINK_COOKIE, token, {
        httpOnly: true,
        secure: rt.secureCookies,
        sameSite: 'Strict',
        path: cookiePath,
        maxAge: Math.max(1, Math.floor(remaining / 1000)),
      });
      return c.redirect(rt.signingPageUrl, 303);
    }
    deleteCookie(c, LINK_COOKIE, { path: cookiePath, secure: rt.secureCookies });
    const found = tokenHash ? await linkState(rt, tokenHash, now) : null;
    const query = new URLSearchParams({
      state: found && found.state !== 'active' ? found.state : 'invalid',
      ...(found?.workspaceId ? { w: found.workspaceId } : {}),
    });
    const page = rt.signingPageUrl;
    return c.redirect(`${page}${page.includes('?') ? '&' : '?'}${query}`, 303);
  });

  return app;
}
