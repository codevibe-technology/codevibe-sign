import 'server-only';
import { readFileSync } from 'node:fs';
import {
  createSignServer,
  mailOtpSender,
  postgresStore,
  type SignServer,
} from '@codevibe_technology/sign-server';
import { resolveApiKey } from '../api-keys';
import { auth } from '../auth/auth';
import { db } from '../db';
import { senderOf } from '../envelopes';
import { env } from '../env';
import { appRuntime } from '../runtime';
import { findMembership } from '../workspaces';
import { createAuthenticate } from './principal';
import { webhookTargets } from './webhooks';

export const SIGN_BASE_PATH = '/api';

function build(): SignServer {
  const config = env();
  if (!config.SEAL_P12_PATH) {
    throw new Error(
      'SEAL_P12_PATH is not set. Point it at the PKCS#12 seal certificate ' +
        '(run `pnpm --filter web dev:seal` for a development one).',
    );
  }
  const sql = db();
  const { files, mailer } = appRuntime();
  return createSignServer({
    store: postgresStore(sql),
    files,
    mailer,
    otp: mailOtpSender(mailer),
    sealer: {
      p12: readFileSync(config.SEAL_P12_PATH),
      passphrase: config.SEAL_PASSPHRASE,
      allowWeakKey: config.SEAL_ALLOW_WEAK_KEY,
    },
    apiKeys: [],
    authenticate: createAuthenticate({
      appUrl: config.APP_URL,
      resolveApiKey: (key) => resolveApiKey(sql, key),
      sessionUser: async (headers) => (await auth().api.getSession({ headers }))?.user ?? null,
      roleOf: async (userId, workspaceId) =>
        (await findMembership(sql, userId, { id: workspaceId }))?.role ?? null,
      isSender: async (userId, workspaceId, envelopeId) =>
        (await senderOf(sql, workspaceId, envelopeId))?.userId === userId,
    }),
    webhookTargets,
    basePath: SIGN_BASE_PATH,
    publicUrl: config.APP_URL,
    signingPageUrl: `${config.APP_URL}/sign`,
    trustProxy: config.TRUST_PROXY,
    effects: 'background',
    ...(config.SIGN_SESSION_SECRET ? { sessionSecret: config.SIGN_SESSION_SECRET } : {}),
  });
}

const holder = globalThis as unknown as { __cvsSign?: SignServer };

/** The sign server mounted at `/api`, created on first use. */
export function signServer(): SignServer {
  holder.__cvsSign ??= build();
  return holder.__cvsSign;
}

/** Hands a request to the sign server unchanged; for route handlers. */
export const handleSignRequest = (request: Request) => signServer().app.fetch(request);
