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
} from '@codevibe/sign-core';
import { randomBytes } from 'node:crypto';
import { nodeHasher } from '../crypto';
import type { PdfEngine } from '../engine';
import { consoleLogger, type Logger } from '../errors';
import { normalizeApiKeys, type StoredApiKey } from '../http/auth';
import { redactingLogger } from '../http/redact';
import { memoryRateLimiter, type RateLimiter } from '../http/rate-limit';
import type { Limits, SealerOptions, SignServerOptions, WebhookTarget } from '../options';
import type { ServerStore } from '../store/types';
import { defaultTemplates, type MailTemplates } from '../templates';

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
  fetch: typeof fetch;
  limits: Required<Limits>;
  webhooks: WebhookTarget[];
  templates: MailTemplates;
  apiKeys: StoredApiKey[];
  sealer: Required<SealerOptions>;
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

function proxyHops(value: number | undefined): number {
  const hops = value ?? 1;
  if (!Number.isInteger(hops) || hops < 1 || hops > 20) {
    throw new Error('trustedProxyHops must be a whole number from 1 to 20');
  }
  return hops;
}

export function createRuntime(options: SignServerOptions, pdf: PdfEngine): Runtime {
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(publicUrl)) throw new Error('publicUrl must be an http(s) URL');
  for (const hook of options.webhooks ?? []) {
    if (!/^https?:\/\//.test(hook.url)) throw new Error(`Webhook URL ${hook.url} must be http(s)`);
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
    fetch: options.fetch ?? fetch,
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    webhooks: options.webhooks ?? [],
    templates: { ...defaultTemplates, ...options.templates },
    apiKeys: normalizeApiKeys(options.apiKeys),
    sealer: {
      p12: options.sealer.p12,
      passphrase: options.sealer.passphrase,
      reason: options.sealer.reason ?? 'Signed and sealed by Codevibe Sign',
      location: options.sealer.location ?? '',
    },
    signingUrl: options.signingUrl ?? ((token) => `${publicUrl}/sign/${token}`),
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
