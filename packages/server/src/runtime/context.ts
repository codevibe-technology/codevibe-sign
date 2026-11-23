import {
  cryptoRandom,
  randomIds,
  systemClock,
  type Clock,
  type FileStore,
  type Hasher,
  type IdGenerator,
  type Mailer,
  type OtpSender,
  type RandomSource,
} from '@codevibe_technology/sign-core';
import { randomBytes } from 'node:crypto';
import { nodeHasher } from '../crypto';
import type { PdfEngine, SealTrust } from '../engine';
import { consoleLogger, type Logger } from '../errors';
import { normalizeApiKeys, type StoredApiKey } from '../http/auth';
import { redactingLogger } from '../http/redact';
import { memoryRateLimiter, type RateLimiter } from '../http/rate-limit';
import type {
  EnvelopeChange,
  Limits,
  SealerOptions,
  SignServerOptions,
  WebhookDeliveryReport,
  WebhookTarget,
} from '../options';
import type { ServerStore } from '../store/types';
import type { Principal } from '../tenancy';
import { defaultTemplates, type MailTemplates, type WorkspaceMail } from '../templates';
import { checkWebhookUrl, type WebhookSecurity } from './webhook-guard';

export interface Runtime {
  store: ServerStore;
  files: FileStore;
  mailer: Mailer;
  otp: OtpSender;
  pdf: PdfEngine;
  clock: Clock;
  ids: IdGenerator;
  hasher: Hasher;
  random: RandomSource;
  limiter: RateLimiter;
  logger: Logger;
  /** Set only when the integrator passed `fetch`; otherwise webhooks use a pinned connection. */
  fetch?: typeof fetch;
  webhookSecurity: WebhookSecurity;
  limits: Required<Limits>;
  webhooks: WebhookTarget[];
  templates: MailTemplates;
  workspaceMail?: (workspaceId: string) => Promise<WorkspaceMail | null>;
  certificateNote?: (workspaceId: string) => Promise<string | null>;
  timeZone?: string;
  apiKeys: StoredApiKey[];
  authenticate?: (request: Request) => Promise<Principal | null>;
  webhookTargets?: (workspaceId: string) => Promise<WebhookTarget[]>;
  onWebhookDelivery?: (report: WebhookDeliveryReport) => void | Promise<void>;
  onEnvelopeChange?: (change: EnvelopeChange) => void | Promise<void>;
  /** Base URL of the server, without a trailing slash. */
  publicUrl: string;
  /** Prefix of every route and cookie path, without a trailing slash; empty by default. */
  basePath: string;
  sealer: Required<Omit<SealerOptions, 'trust' | 'tsaUrl' | 'tsaRequired'>> &
    Pick<SealerOptions, 'tsaUrl' | 'tsaRequired'>;
  /** What a sealed file must be signed by to verify; empty when the engine cannot tell. */
  sealTrust: SealTrust | null;
  signingUrl: (token: string) => string;
  /** Where `GET /sign/:token` sends the browser once the token is in its cookie. */
  signingPageUrl: string;
  /** Cookies get `Secure` when the public URL is https. */
  secureCookies: boolean;
  sessionSecret: string;
  tokenTtlMs: number;
  trustProxy: boolean;
  trustedProxyHops: number;
  effects: 'await' | 'background';
  /** Background job runs still going, so shutdown can wait for them. */
  inflight: Set<Promise<unknown>>;
}

const DEFAULT_LIMITS: Required<Limits> = {
  maxPdfBytes: 20 * 1024 * 1024,
  maxRequestBytes: 50 * 1024 * 1024,
  maxDocuments: 20,
  envelopesPerMinute: 60,
  signerRequestsPerMinute: 60,
  ipRequestsPerMinute: 120,
  otpSendsPer15Minutes: 5,
  otpCodesPerRecipient: 10,
  maxAttachmentBytes: 10 * 1024 * 1024,
};

/**
 * Opens the seal key once at start-up, so a missing, weak or expired key stops the server
 * instead of the first completion, and learns the certificate sealed files must carry.
 */
function sealTrust(options: SignServerOptions, pdf: PdfEngine): SealTrust | null {
  if (!pdf.sealCertificate) return null;
  const { sha256 } = pdf.sealCertificate({
    p12: options.sealer.p12,
    passphrase: options.sealer.passphrase,
    allowWeakKey: options.sealer.allowWeakKey ?? false,
  });
  const extra = options.sealer.trust ?? {};
  return { ...extra, fingerprints: [sha256, ...(extra.fingerprints ?? [])] };
}

function normalizeBasePath(value: string | undefined): string {
  const path = (value ?? '').replace(/\/+$/, '');
  if (path !== '' && !/^(\/[A-Za-z0-9._~-]+)+$/.test(path)) {
    throw new Error('basePath must look like /api');
  }
  return path;
}

function proxyHops(value: number | undefined): number {
  const hops = value ?? 1;
  if (!Number.isInteger(hops) || hops < 1 || hops > 20) {
    throw new Error('trustedProxyHops must be a whole number from 1 to 20');
  }
  return hops;
}

function checkedTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    throw new Error(`timeZone "${timeZone}" is not known. Use an IANA name such as Asia/Kolkata.`);
  }
  return timeZone;
}

export function createRuntime(options: SignServerOptions, pdf: PdfEngine): Runtime {
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const basePath = normalizeBasePath(options.basePath);
  if (!/^https?:\/\//.test(publicUrl)) throw new Error('publicUrl must be an http(s) URL');
  const webhookSecurity = options.webhookSecurity ?? {};
  for (const hook of options.webhooks ?? []) {
    try {
      checkWebhookUrl(hook.url, webhookSecurity);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : 'Invalid webhook URL'}: ${hook.url}`);
    }
    if (hook.secret.length < 16) throw new Error(`Webhook secret for ${hook.url} is too short`);
  }
  return {
    store: options.store,
    files: options.files,
    mailer: options.mailer,
    otp: options.otp,
    pdf,
    clock: options.clock ?? systemClock,
    ids: options.ids ?? randomIds,
    hasher: options.hasher ?? nodeHasher,
    random: options.random ?? cryptoRandom,
    limiter: options.rateLimiter ?? memoryRateLimiter(),
    logger: redactingLogger(options.logger ?? consoleLogger),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    webhookSecurity,
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    webhooks: options.webhooks ?? [],
    templates: { ...defaultTemplates, ...options.templates },
    ...(options.workspaceMail ? { workspaceMail: options.workspaceMail } : {}),
    ...(options.certificateNote ? { certificateNote: options.certificateNote } : {}),
    ...(options.timeZone ? { timeZone: checkedTimeZone(options.timeZone) } : {}),
    apiKeys: normalizeApiKeys(options.apiKeys, options.authenticate !== undefined),
    ...(options.authenticate ? { authenticate: options.authenticate } : {}),
    ...(options.webhookTargets ? { webhookTargets: options.webhookTargets } : {}),
    ...(options.onWebhookDelivery ? { onWebhookDelivery: options.onWebhookDelivery } : {}),
    ...(options.onEnvelopeChange ? { onEnvelopeChange: options.onEnvelopeChange } : {}),
    publicUrl,
    basePath,
    sealer: {
      p12: options.sealer.p12,
      passphrase: options.sealer.passphrase,
      reason: options.sealer.reason ?? 'Signed and sealed by Codevibe Sign',
      location: options.sealer.location ?? '',
      allowWeakKey: options.sealer.allowWeakKey ?? false,
      ...(options.sealer.tsaUrl ? { tsaUrl: options.sealer.tsaUrl } : {}),
      ...(options.sealer.tsaRequired !== undefined
        ? { tsaRequired: options.sealer.tsaRequired }
        : {}),
    },
    sealTrust: sealTrust(options, pdf),
    signingUrl: options.signingUrl ?? ((token) => `${publicUrl}${basePath}/sign/${token}`),
    signingPageUrl: options.signingPageUrl ?? `${publicUrl}/sign`,
    secureCookies: publicUrl.startsWith('https:'),
    sessionSecret: options.sessionSecret ?? randomBytes(32).toString('hex'),
    tokenTtlMs: (options.tokenTtlDays ?? 30) * 86_400_000,
    trustProxy: options.trustProxy ?? false,
    trustedProxyHops: proxyHops(options.trustedProxyHops),
    effects: options.effects ?? 'await',
    inflight: new Set(),
  };
}
