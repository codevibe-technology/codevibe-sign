import 'server-only';
import { readFileSync } from 'node:fs';
import {
  createSignServer,
  mailOtpSender,
  postgresStore,
  type SignServer,
} from '@codevibe_technology/sign-server';
import { resolveApiKey } from '../api-keys';
import { getBrand } from '../brand';
import { auth } from '../auth/auth';
import { db } from '../db';
import { senderOf } from '../envelopes';
import { env } from '../env';
import { appRuntime } from '../runtime';
import { findMembership } from '../workspaces';
import { planSettings } from '../plans';
import { isSampleEnvelope } from '../sample-envelope';
import { createWorkspaceMail } from './mail';
import { createPlanGate } from './plan-gate';
import { createAuthenticate } from './principal';
import { recordDelivery } from '../webhooks';
import { webhookSecurity, webhookTargets } from './webhooks';

export const SIGN_BASE_PATH = '/api';

/**
 * Whether this install can send one-time codes by text message. Codes go out by email only
 * (`mailOtpSender`), so the signing page tells SMS recipients to ask for an email instead.
 */
export const SMS_CODES = false;

/** Largest request body the sign server accepts; its default. */
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;

function authenticate() {
  const config = env();
  const sql = db();
  return createAuthenticate({
    appUrl: config.APP_URL,
    resolveApiKey: (key) => resolveApiKey(sql, key),
    sessionUser: async (headers) => (await auth().api.getSession({ headers }))?.user ?? null,
    roleOf: async (userId, workspaceId) =>
      (await findMembership(sql, userId, { id: workspaceId }))?.role ?? null,
    isSender: async (userId, workspaceId, envelopeId) =>
      (await senderOf(sql, workspaceId, envelopeId))?.userId === userId,
  });
}

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
    authenticate: authenticate(),
    limits: { maxRequestBytes: MAX_REQUEST_BYTES },
    webhookTargets,
    webhookSecurity: webhookSecurity(),
    onWebhookDelivery: (report) => recordDelivery(sql, report),
    workspaceMail: createWorkspaceMail({
      appUrl: config.APP_URL,
      brand: (workspaceId) => getBrand(sql, workspaceId),
      workspaceName: async (workspaceId) =>
        (
          await sql<{ name: string }[]>`select name from app_workspaces where id = ${workspaceId}`
        )[0]?.name ?? null,
    }),
    certificateNote: async (workspaceId) => (await getBrand(sql, workspaceId)).certificateFooter,
    basePath: SIGN_BASE_PATH,
    publicUrl: config.APP_URL,
    signingPageUrl: `${config.APP_URL}/sign`,
    trustProxy: config.TRUST_PROXY,
    effects: 'background',
    ...(config.SIGN_SESSION_SECRET ? { sessionSecret: config.SIGN_SESSION_SECRET } : {}),
  });
}

type Gate = ReturnType<typeof createPlanGate>;

const holder = globalThis as unknown as { __cvsSign?: SignServer; __cvsSignGate?: Gate };

/** The sign server mounted at `/api`, created on first use. */
export function signServer(): SignServer {
  holder.__cvsSign ??= build();
  return holder.__cvsSign;
}

function gate(): Gate {
  const sql = db();
  holder.__cvsSignGate ??= createPlanGate({
    sql,
    settings: () => planSettings(),
    authenticate: authenticate(),
    isSampleEnvelope: (workspaceId, envelopeId) => isSampleEnvelope(sql, workspaceId, envelopeId),
    basePath: SIGN_BASE_PATH,
    maxBodyBytes: MAX_REQUEST_BYTES,
  });
  return holder.__cvsSignGate;
}

/**
 * Hands a request to the sign server; every call, from a browser, an API key or the app
 * itself, goes this way. On the hosted cloud it passes the workspace's plan limits first.
 */
export const handleSignRequest = async (request: Request): Promise<Response> => {
  if (planSettings().mode === 'self-hosted') return signServer().app.fetch(request);
  return gate()(request, async (r) => signServer().app.fetch(r));
};
