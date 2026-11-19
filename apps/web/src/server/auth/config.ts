import type { BetterAuthOptions } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import type postgres from 'postgres';

export interface AuthConfigInput {
  sql: postgres.Sql;
  appUrl: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  sendMagicLink: (email: string, url: string) => Promise<void>;
}

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

/**
 * Better Auth's options, kept apart from the instance so tests can check that the tables our
 * migration creates are exactly what this configuration expects.
 */
export function authOptions(input: AuthConfigInput) {
  return {
    appName: 'Codevibe Sign',
    baseURL: input.appUrl,
    basePath: '/api/auth',
    secret: input.secret,
    trustedOrigins: [input.appUrl],
    telemetry: { enabled: false },
    database: {
      db: new Kysely({ dialect: new PostgresJSDialect({ postgres: input.sql }) }),
      type: 'postgres',
    },
    user: {
      modelName: 'auth_users',
      fields: { emailVerified: 'email_verified', ...timestamps },
    },
    session: {
      modelName: 'auth_sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        ...timestamps,
      },
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        ...timestamps,
      },
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: { expiresAt: 'expires_at', ...timestamps },
    },
    emailAndPassword: { enabled: false },
    socialProviders: input.google
      ? { google: { clientId: input.google.clientId, clientSecret: input.google.clientSecret } }
      : {},
    advanced: {
      cookiePrefix: 'cvs',
      useSecureCookies: input.appUrl.startsWith('https://'),
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: 'hashed',
        sendMagicLink: ({ email, url }) => input.sendMagicLink(email, url),
      }),
    ],
  } satisfies BetterAuthOptions;
}
