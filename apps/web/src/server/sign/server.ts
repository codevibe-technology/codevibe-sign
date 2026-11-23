import 'server-only';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createSignServer,
  mailOtpSender,
  postgresStore,
  type SignServer,
} from '@codevibe_technology/sign-server';
import { resolveApiKey } from '../api-keys';
import { defaultCertificateNote } from '@/lib/brand';
import { getBrand } from '../brand';
import { auth } from '../auth/auth';
import { db } from '../db';
import { senderOf } from '../envelopes';
import { env, type Env } from '../env';
import { mailSenderOnDecline } from '../decline-mail';
import { publishChange } from '../live/live';
import { completedCopyAttachmentLimit } from '../mail-transport';
import { appRuntime } from '../runtime';
import { findMembership, workspaceTimeZone } from '../workspaces';
import { planSettings } from '../plans';
import { isSampleEnvelope } from '../sample-envelope';
import { getTemplate } from '../templates';
import { createWorkspaceMail } from './mail';
import { createPlanGate } from './plan-gate';
import { appTemplateStore } from './templates';
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
/** Larger sealed copies go out as a download link; many mailboxes refuse big attachments. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Signs signer sessions, receipts and emailed download links. Without SIGN_SESSION_SECRET it
 * is derived from AUTH_SECRET, so links keep working across restarts and processes.
 */
const sessionSecret = (config: Env) =>
  config.SIGN_SESSION_SECRET ??
  createHmac('sha256', config.AUTH_SECRET).update('codevibe-sign/session').digest('hex');

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
  const store = postgresStore(sql);
  const declineMail = {
    sql,
    mailer,
    appUrl: config.APP_URL,
    load: async (id: string) => (await store.load(id))?.envelope ?? null,
  };
  return createSignServer({
    store,
    templateStore: appTemplateStore(sql, files),
    files,
    mailer,
    otp: mailOtpSender(mailer),
    sealer: {
      p12: readFileSync(config.SEAL_P12_PATH),
      passphrase: config.SEAL_PASSPHRASE,
      allowWeakKey: config.SEAL_ALLOW_WEAK_KEY,
      ...(config.SEAL_TSA_URL
        ? { tsaUrl: config.SEAL_TSA_URL, tsaRequired: config.SEAL_TSA_REQUIRED ?? true }
        : {}),
    },
    apiKeys: [],
    authenticate: authenticate(),
    limits: {
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxAttachmentBytes: completedCopyAttachmentLimit(config, MAX_ATTACHMENT_BYTES),
    },
    webhookTargets,
    webhookSecurity: webhookSecurity(),
    onWebhookDelivery: (report) => recordDelivery(sql, report),
    onEnvelopeChange: async (change) => {
      // The email goes out after the response; a failure is logged, not shown to the signer.
      void mailSenderOnDecline(declineMail, change).catch((err: unknown) =>
        console.error('[decline mail] failed', err instanceof Error ? err.message : err),
      );
      await publishChange(sql, change);
    },
    workspaceMail: createWorkspaceMail({
      appUrl: config.APP_URL,
      brand: (workspaceId) => getBrand(sql, workspaceId),
      workspaceName: async (workspaceId) =>
        (
          await sql<{ name: string }[]>`select name from app_workspaces where id = ${workspaceId}`
        )[0]?.name ?? null,
    }),
    certificateNote: async (workspaceId) =>
      (await getBrand(sql, workspaceId)).certificateFooter ??
      defaultCertificateNote(new URL(config.APP_URL).host),
    basePath: SIGN_BASE_PATH,
    publicUrl: config.APP_URL,
    signingPageUrl: `${config.APP_URL}/sign`,
    trustProxy: config.TRUST_PROXY,
    ...(config.SIGN_TIME_ZONE ? { timeZone: config.SIGN_TIME_ZONE } : {}),
    workspaceTimeZone: (workspaceId) => workspaceTimeZone(sql, workspaceId),
    effects: 'background',
    sessionSecret: sessionSecret(config),
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
    templateSizes: async (workspaceId, templateId) =>
      (await getTemplate(sql, workspaceId, templateId))?.definition.documents.map((d) => d.size) ??
      null,
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
