import 'server-only';
import { APIError, betterAuth } from 'better-auth';
import { db } from '../db';
import { env, googleEnabled } from '../env';
import { sendMagicLink } from '../mail';
import { appRuntime } from '../runtime';
import { authOptions } from './config';
import { limitMagicLinks, TooManySignInLinks } from './magic-link-limit';

function createAuth() {
  const config = env();
  const send = limitMagicLinks((email, url) => sendMagicLink(appRuntime().mailer, email, url));
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

const holder = globalThis as unknown as { __cvsAuth?: Auth };

/** The Better Auth instance, created on first use so builds never need the configuration. */
export function auth(): Auth {
  holder.__cvsAuth ??= createAuth();
  return holder.__cvsAuth;
}
