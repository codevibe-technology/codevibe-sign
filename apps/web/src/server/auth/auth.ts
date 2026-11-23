import 'server-only';
import { APIError, betterAuth } from 'better-auth';
import { db } from '../db';
import { env, googleEnabled } from '../env';
import { sendMagicLink, sendPasswordChanged, sendPasswordReset } from '../mail';
import { appRuntime } from '../runtime';
import { authOptions, RESET_LINK_MINUTES } from './config';
import { limitMagicLinks, limitResetLinks, TooManySignInLinks } from './magic-link-limit';
import { guardPasswords } from './password-guard';
import { passwordLockout, type PasswordLockout } from './password-lockout';

function createAuth() {
  const config = env();
  const send = limitMagicLinks((email, url) => sendMagicLink(appRuntime().mailer, email, url));
  const sendReset = limitResetLinks((email, url) =>
    sendPasswordReset(appRuntime().mailer, email, url, RESET_LINK_MINUTES),
  );
  return betterAuth(
    authOptions({
      sql: db(),
      appUrl: config.APP_URL,
      secret: config.AUTH_SECRET,
      ...(googleEnabled(config)
        ? {
            google: {
              clientId: config.GOOGLE_CLIENT_ID!,
              clientSecret: config.GOOGLE_CLIENT_SECRET!,
            },
          }
        : {}),
      sendPasswordReset: sendReset,
      passwordChanged: (email) => notifyPasswordChanged(email),
      sendMagicLink: async (email, url) => {
        try {
          await send(email, url);
        } catch (err) {
          if (!(err instanceof TooManySignInLinks)) throw err;
          throw new APIError('TOO_MANY_REQUESTS', { message: err.message });
        }
      },
    }),
  );
}

export type Auth = ReturnType<typeof createAuth>;

/** Tells an account's owner its password was set or changed. A failure is logged, not shown. */
export async function notifyPasswordChanged(email: string): Promise<void> {
  await sendPasswordChanged(appRuntime().mailer, email, `${env().APP_URL}/sign-in`).catch(
    (err: unknown) =>
      console.error('[password changed mail] failed', err instanceof Error ? err.message : err),
  );
}

const holder = globalThis as unknown as {
  __cvsAuth?: Auth;
  __cvsLockout?: PasswordLockout;
  __cvsAuthHandler?: (request: Request) => Promise<Response>;
};

/** The Better Auth instance, created on first use so builds never need the configuration. */
export function auth(): Auth {
  holder.__cvsAuth ??= createAuth();
  return holder.__cvsAuth;
}

/** Wrong-password counts per address, shared by every way a password is checked. */
export function lockout(): PasswordLockout {
  holder.__cvsLockout ??= passwordLockout();
  return holder.__cvsLockout;
}

/** Handles `/api/auth/*`, with the password rules in front of the library. */
export function handleAuth(request: Request): Promise<Response> {
  holder.__cvsAuthHandler ??= guardPasswords((r) => auth().handler(r), lockout());
  return holder.__cvsAuthHandler(request);
}
