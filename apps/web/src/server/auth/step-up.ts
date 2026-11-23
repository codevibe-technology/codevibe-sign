import { AppError } from '../errors';
import type { PasswordLockout } from './password-lockout';

/** How recent a sign-in has to be to count as proof, for someone who has no password. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

/** The field that tells a form to offer "Sign in again" instead of a password box. */
export const REAUTH_FIELD = 'reauth';

export interface StepUpDeps {
  hasPassword: (userId: string) => Promise<boolean>;
  /** Whether `password` is this person's password. */
  verifyPassword: (userId: string, password: string) => Promise<boolean>;
  lockout: PasswordLockout;
}

/**
 * Checks that the signed-in person is really at the keyboard before something that cannot be
 * undone by them alone. Someone with a password types it again; wrong ones count towards the
 * same pause as at sign-in. Someone who signs in only with emailed links or Google must have
 * signed in within the last few minutes.
 */
export async function confirmIdentity(
  deps: StepUpDeps,
  user: { id: string; email: string },
  input: { password?: string | undefined; sessionStartedAt: Date | null; now?: Date },
): Promise<'password' | 'recent-sign-in'> {
  if (await deps.hasPassword(user.id)) {
    const minutes = deps.lockout.lockedFor(user.email);
    if (minutes > 0) {
      throw new AppError(
        'CONFLICT',
        `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or use "Forgot password" on the sign-in page.`,
        'password',
      );
    }
    if (!input.password) {
      throw new AppError('VALIDATION', 'Enter your password to confirm it is you', 'password');
    }
    if (!(await deps.verifyPassword(user.id, input.password))) {
      deps.lockout.failed(user.email);
      throw new AppError(
        'VALIDATION',
        'That is not your password. Try again, or use "Forgot password" on the sign-in page.',
        'password',
      );
    }
    deps.lockout.clear(user.email);
    return 'password';
  }
  const now = input.now ?? new Date();
  if (
    input.sessionStartedAt &&
    now.getTime() - input.sessionStartedAt.getTime() <= RECENT_SIGN_IN_MS
  ) {
    return 'recent-sign-in';
  }
  throw new AppError(
    'UNAUTHORIZED',
    'For your safety this needs a fresh sign-in. Sign in again, then come back to this page to finish.',
    REAUTH_FIELD,
  );
}
