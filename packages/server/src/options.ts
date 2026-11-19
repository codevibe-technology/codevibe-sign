import type {
  Clock,
  FileStore,
  Hasher,
  IdGenerator,
  Mailer,
  OtpSender,
  RandomSource,
} from '@codevibe/sign-core';
import type { PdfEngine } from './engine';
import type { Logger } from './errors';
import type { RateLimiter } from './http/rate-limit';
import type { ServerStore } from './store/types';
import type { MailTemplates } from './templates';

export interface ApiKey {
  /** Shown in logs and used to scope idempotency keys and rate limits. Never the secret. */
  id: string;
  key: string;
}

export interface SealerOptions {
  /** PKCS#12 file with the operator certificate and private key. */
  p12: Uint8Array;
  passphrase: string;
  reason?: string;
  location?: string;
}

export interface Limits {
  /** Largest accepted PDF, in bytes. Default 20 MB. */
  maxPdfBytes?: number;
  /** Largest request body, in bytes. Default 50 MB. */
  maxRequestBytes?: number;
  /** Most documents in one envelope. Default 20. */
  maxDocuments?: number;
  /** Envelopes one API key may create per minute. Default 60. */
  envelopesPerMinute?: number;
  /** Requests per minute for one signing token. Default 60. */
  signerRequestsPerMinute?: number;
  /** Signing requests per minute from one IP address. Default 120. */
  ipRequestsPerMinute?: number;
  /** OTP codes sent to one recipient per 15 minutes. Default 5. */
  otpSendsPer15Minutes?: number;
  /** Total size of sealed files attached to the completion email. Default 10 MB. */
  maxAttachmentBytes?: number;
}

export type WebhookEvent = string;

export interface WebhookTarget {
  url: string;
  secret: string;
  /** Audit actions to deliver, for example `envelope.completed`; `*` for all. */
  events: WebhookEvent[];
}

export interface SignServerOptions {
  store: ServerStore;
  files: FileStore;
  mailer: Mailer;
  otp: OtpSender;
  sealer: SealerOptions;
  /** Sender credentials, checked from `Authorization: Bearer <key>`. */
  apiKeys: (ApiKey | string)[];
  /** Base URL of the signing page. Links are `${publicUrl}/sign/<token>` unless `signingUrl` is set. */
  publicUrl: string;
  signingUrl?: (token: string) => string;
  limits?: Limits;
  webhooks?: WebhookTarget[];
  templates?: Partial<MailTemplates>;
  /** Signs signer session tokens. Set it when more than one process serves requests. */
  sessionSecret?: string;
  /** Signing links stay valid this many days unless the envelope expires sooner. Default 30. */
  tokenTtlDays?: number;
  /** Read the client IP from `X-Forwarded-For`. Only enable behind a proxy you control. */
  trustProxy?: boolean;
  /**
   * How many proxies you control sit in front of the server, each appending to
   * `X-Forwarded-For`. The client IP is taken that many entries from the right. Default 1.
   */
  trustedProxyHops?: number;
  /**
   * `await` (default) runs emails, webhooks and sealing before the response is sent; failures
   * are retried by `tick()`. `background` returns first and runs them afterwards.
   */
  effects?: 'await' | 'background';
  clock?: Clock;
  ids?: IdGenerator;
  hasher?: Hasher;
  random?: RandomSource;
  rateLimiter?: RateLimiter;
  logger?: Logger;
  fetch?: typeof fetch;
  /** PDF reading, drawing and sealing. Defaults to `@codevibe/sign-pdf`. */
  pdf?: PdfEngine;
}
