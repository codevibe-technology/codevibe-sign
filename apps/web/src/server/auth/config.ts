import type { BetterAuthOptions } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins/magic-link';
import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import type postgres from 'postgres';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/password';

export interface AuthConfigInput {
  sql: postgres.Sql;
  appUrl: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  sendMagicLink: (email: string, url: string) => Promise<void>;
  /** Emails the link that lets someone choose a new password. */
  sendPasswordReset: (email: string, url: string) => Promise<void>;
  /** Tells the account's owner their password was just set or changed. */
  passwordChanged: (email: string) => Promise<void>;
}

/** A reset link is as good as the password, so it does not live long. */
export const RESET_LINK_MINUTES = 30;

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
    // Accounts are only ever created from an emailed link (sign-in or invitation), so the
    // address is confirmed before a password exists. A password is added afterwards.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => input.sendPasswordReset(user.email, url),
      onPasswordReset: ({ user }) => input.passwordChanged(user.email),
    },
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
      // Lets a server action that changes the session (a new password) set its cookie.
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}
