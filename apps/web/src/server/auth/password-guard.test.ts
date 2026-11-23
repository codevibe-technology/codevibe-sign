import { describe, expect, it, vi } from 'vitest';
import { limitResetLinks, MAGIC_LINKS_PER_WINDOW } from './magic-link-limit';
import { guardPasswords } from './password-guard';
import { LOCKOUT_WINDOW_MS, MAX_FAILED_SIGN_INS, passwordLockout } from './password-lockout';

const START = new Date('2026-11-23T10:00:00.000Z').getTime();

function clock() {
  let now = START;
  return { now: () => new Date(now), advance: (ms: number) => void (now += ms) };
}

describe('passwordLockout', () => {
  it('opens until the fifth wrong password, then says how long is left', () => {
    const time = clock();
    const lockout = passwordLockout(time.now);
    for (let i = 0; i < MAX_FAILED_SIGN_INS - 1; i++) lockout.failed('asha@example.com');
    expect(lockout.lockedFor('asha@example.com')).toBe(0);
    lockout.failed('asha@example.com');
    expect(lockout.lockedFor('asha@example.com')).toBe(15);
    time.advance(10 * 60_000 + 1);
    expect(lockout.lockedFor('asha@example.com')).toBe(5);
    time.advance(5 * 60_000);
    expect(lockout.lockedFor('asha@example.com')).toBe(0);
  });

  it('treats an address the same in any case and keeps addresses apart', () => {
    const lockout = passwordLockout(clock().now);
    for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) lockout.failed(' Asha@Example.com ');
    expect(lockout.lockedFor('asha@example.com')).toBeGreaterThan(0);
    expect(lockout.lockedFor('ravi@example.com')).toBe(0);
  });

  it('starts a fresh count once the window has passed or the address is cleared', () => {
    const time = clock();
    const lockout = passwordLockout(time.now);
    for (let i = 0; i < MAX_FAILED_SIGN_INS - 1; i++) lockout.failed('asha@example.com');
    time.advance(LOCKOUT_WINDOW_MS);
    lockout.failed('asha@example.com');
    expect(lockout.lockedFor('asha@example.com')).toBe(0);
    for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) lockout.failed('asha@example.com');
    expect(lockout.lockedFor('asha@example.com')).toBeGreaterThan(0);
    lockout.clear('ASHA@example.com');
    expect(lockout.lockedFor('asha@example.com')).toBe(0);
  });

  it('never holds more addresses than it was told to', () => {
    const lockout = passwordLockout(clock().now, 3);
    for (let i = 0; i < 10; i++) {
      for (let n = 0; n < MAX_FAILED_SIGN_INS; n++) lockout.failed(`user${i}@example.com`);
    }
    expect(lockout.lockedFor('user0@example.com')).toBe(0);
    expect(lockout.lockedFor('user9@example.com')).toBeGreaterThan(0);
  });
});

describe('guardPasswords', () => {
  const post = (path: string, body: unknown) =>
    new Request(`https://sign.example.com/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  function setup(status = 401) {
    const time = clock();
    const lockout = passwordLockout(time.now);
    const seen: unknown[] = [];
    const handler = vi.fn(async (request: Request) => {
      seen.push(await request.json().catch(() => null));
      return Response.json({}, { status });
    });
    return { time, lockout, seen, handler, guarded: guardPasswords(handler, lockout) };
  }

  it('hands the untouched request on, body included', async () => {
    const { guarded, seen } = setup(200);
    const body = { email: 'asha@example.com', password: 'mango-river-lantern' };
    expect((await guarded(post('/sign-in/email', body))).status).toBe(200);
    expect(seen).toEqual([body]);
  });

  it('stops asking the library once an address is paused', async () => {
    const { guarded, handler } = setup();
    const attempt = () =>
      guarded(post('/sign-in/email', { email: 'asha@example.com', password: 'wrong' }));
    for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) expect((await attempt()).status).toBe(401);
    const paused = await attempt();
    expect(paused.status).toBe(429);
    expect(paused.headers.get('retry-after')).toBe('900');
    expect(await paused.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
    expect(handler).toHaveBeenCalledTimes(MAX_FAILED_SIGN_INS);
  });

  it('only counts refusals of the password, not other failures', async () => {
    const { guarded, lockout } = setup(500);
    for (let i = 0; i < 10; i++) {
      await guarded(post('/sign-in/email', { email: 'asha@example.com', password: 'x' }));
    }
    expect(lockout.lockedFor('asha@example.com')).toBe(0);
  });

  it('checks a new password wherever one is set', async () => {
    const { guarded, handler } = setup(200);
    for (const path of ['/reset-password', '/change-password', '/reset-password/']) {
      const weak = await guarded(post(path, { token: 't', newPassword: 'Password@123' }));
      expect([path, weak.status, (await weak.json()).code]).toEqual([path, 400, 'WEAK_PASSWORD']);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(
      (await guarded(post('/reset-password', { token: 't', newPassword: 'mango-river-lantern' })))
        .status,
    ).toBe(200);
  });

  it('refuses a new password it cannot read', async () => {
    const { guarded } = setup(200);
    expect((await guarded(post('/reset-password', 'not json'))).status).toBe(400);
    expect((await guarded(post('/reset-password', { newPassword: 12345678901 }))).status).toBe(400);
  });

  it('leaves every other request alone', async () => {
    const { guarded, handler } = setup(200);
    await guarded(new Request('https://sign.example.com/api/auth/get-session'));
    await guarded(post('/sign-in/magic-link', { email: 'asha@example.com' }));
    await guarded(
      new Request('https://sign.example.com/api/auth/reset-password/abc?callbackURL=/x'),
    );
    expect(handler).toHaveBeenCalledTimes(3);
  });
});

describe('limitResetLinks', () => {
  it('drops the email over the cap without an error, and opens again later', async () => {
    const time = clock();
    const sent: string[] = [];
    const send = limitResetLinks(async (email) => void sent.push(email), time.now);
    for (let i = 0; i < MAGIC_LINKS_PER_WINDOW + 3; i++) {
      await expect(send('Asha@example.com', 'https://x/reset')).resolves.toBeUndefined();
    }
    await send('ravi@example.com', 'https://x/reset');
    expect(sent.filter((e) => e === 'Asha@example.com')).toHaveLength(MAGIC_LINKS_PER_WINDOW);
    expect(sent).toContain('ravi@example.com');
    time.advance(15 * 60_000);
    await send('asha@example.com', 'https://x/reset');
    expect(sent).toHaveLength(MAGIC_LINKS_PER_WINDOW + 2);
  });
});
