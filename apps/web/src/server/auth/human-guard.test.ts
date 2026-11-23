import { describe, expect, it, vi } from 'vitest';
import type { HumanCheck } from '../human-check';
import { guardHumans, HUMAN_CHECKED_PATHS } from './human-guard';

const post = (path: string, token?: string) =>
  new Request(`https://sign.example.com/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-turnstile-token': token } : {}),
    },
    body: JSON.stringify({ email: 'asha@example.com' }),
  });

function setup(result: (token: string | null) => HumanCheck) {
  const handler = vi.fn(async () => Response.json({ ok: true }));
  const check = vi.fn(async (token: string | null) => result(token));
  return { handler, check, guarded: guardHumans(handler, check) };
}

const passIfToken = (token: string | null): HumanCheck =>
  token === 'good' ? { ok: true } : { ok: false, reason: token ? 'rejected' : 'missing' };

describe('guardHumans', () => {
  it('checks sign-in, sign-in links, reset and verification emails', async () => {
    const { guarded, handler } = setup(passIfToken);
    for (const path of HUMAN_CHECKED_PATHS) {
      const refused = await guarded(post(path));
      expect([path, refused.status]).toEqual([path, 403]);
      expect(await refused.json()).toMatchObject({
        code: 'HUMAN_CHECK',
        message: expect.stringContaining('Reload the page'),
      });
    }
    expect(handler).not.toHaveBeenCalled();
    for (const path of HUMAN_CHECKED_PATHS) {
      expect((await guarded(post(path, 'good'))).status).toBe(200);
    }
    expect(handler).toHaveBeenCalledTimes(HUMAN_CHECKED_PATHS.length);
  });

  it('cannot be stepped around with a trailing or doubled slash', async () => {
    const { guarded, handler } = setup(passIfToken);
    for (const path of ['/sign-in/magic-link/', '//sign-in/email', '/request-password-reset//']) {
      expect((await guarded(post(path))).status, path).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('says to try again when the token was refused, and to wait when Cloudflare is down', async () => {
    const rejected = await setup(passIfToken).guarded(post('/sign-in/email', 'stale'));
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).message).toContain('Try again');
    const down = await setup(() => ({ ok: false, reason: 'unavailable' })).guarded(
      post('/sign-in/email', 'good'),
    );
    expect(down.status).toBe(503);
    expect((await down.json()).message).toContain('Wait a few seconds');
  });

  it('leaves sessions, sign-out, link visits and Google sign-in alone', async () => {
    const { guarded, handler, check } = setup(passIfToken);
    await guarded(new Request('https://sign.example.com/api/auth/get-session'));
    await guarded(new Request('https://sign.example.com/api/auth/magic-link/verify?token=x'));
    await guarded(post('/sign-out'));
    await guarded(post('/sign-in/social'));
    await guarded(post('/reset-password'));
    expect(handler).toHaveBeenCalledTimes(5);
    expect(check).not.toHaveBeenCalled();
  });

  it('lets everything through when the check is off', async () => {
    const { guarded, handler } = setup(() => ({ ok: true }));
    expect((await guarded(post('/sign-in/magic-link'))).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
