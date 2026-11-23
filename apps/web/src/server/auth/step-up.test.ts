import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors';
import { passwordLockout } from './password-lockout';
import { RECENT_SIGN_IN_MS, REAUTH_FIELD, confirmIdentity, type StepUpDeps } from './step-up';

const user = { id: 'u1', email: 'ravi@example.com' };
const NOW = new Date('2026-11-23T10:00:00Z');

function deps(hasPassword: boolean, correct = 'right horse battery'): StepUpDeps {
  return {
    hasPassword: async () => hasPassword,
    verifyPassword: vi.fn(async (_id: string, password: string) => password === correct),
    lockout: passwordLockout(() => NOW),
  };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('confirmIdentity', () => {
  it('takes the right password from someone who has one', async () => {
    const d = deps(true);
    expect(
      await confirmIdentity(d, user, { password: 'right horse battery', sessionStartedAt: null }),
    ).toBe('password');
  });

  it('asks for the password, then refuses a wrong one next to the field', async () => {
    const d = deps(true);
    const missing = await failure(confirmIdentity(d, user, { sessionStartedAt: NOW }));
    expect(missing).toMatchObject({ code: 'VALIDATION', field: 'password' });
    const wrong = await failure(
      confirmIdentity(d, user, { password: 'nope', sessionStartedAt: NOW }),
    );
    expect(wrong).toMatchObject({ code: 'VALIDATION', field: 'password' });
    expect(wrong.message).toContain('Forgot password');
  });

  it('pauses after too many wrong passwords, even for the right one', async () => {
    const d = deps(true);
    for (let i = 0; i < 5; i++) {
      await failure(confirmIdentity(d, user, { password: 'nope', sessionStartedAt: null }));
    }
    const paused = await failure(
      confirmIdentity(d, user, { password: 'right horse battery', sessionStartedAt: null }),
    );
    expect(paused).toMatchObject({ code: 'CONFLICT', field: 'password' });
    expect(paused.message).toMatch(/Try again in 15 minutes/);
  });

  it('takes a recent sign-in from someone without a password', async () => {
    const d = deps(false);
    const started = new Date(NOW.getTime() - RECENT_SIGN_IN_MS + 1000);
    expect(await confirmIdentity(d, user, { sessionStartedAt: started, now: NOW })).toBe(
      'recent-sign-in',
    );
    expect(d.verifyPassword).not.toHaveBeenCalled();
  });

  it('sends someone without a password to sign in again when their session is old', async () => {
    const d = deps(false);
    const started = new Date(NOW.getTime() - RECENT_SIGN_IN_MS - 1000);
    for (const sessionStartedAt of [started, null]) {
      const stale = await failure(
        confirmIdentity(d, user, { password: 'anything', sessionStartedAt, now: NOW }),
      );
      expect(stale).toMatchObject({ code: 'UNAUTHORIZED', field: REAUTH_FIELD });
      expect(stale.message).toContain('Sign in again');
    }
  });
});
