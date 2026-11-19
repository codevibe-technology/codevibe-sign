import 'server-only';
import { betterAuth } from 'better-auth';
import { db } from '../db';
import { env, googleEnabled } from '../env';
import { sendMagicLink } from '../mail';
import { appRuntime } from '../runtime';
import { authOptions } from './config';

function createAuth() {
  const config = env();
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
      sendMagicLink: (email, url) => sendMagicLink(appRuntime().mailer, email, url),
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
