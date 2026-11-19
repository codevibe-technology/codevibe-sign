import type {
  Clock,
  FileStore,
  Hasher,
  IdGenerator,
  Mailer,
  OtpSender,
  RandomSource,
} from '@codevibe_technology/sign-core';
import type { PdfEngine, SealTrust } from './engine';
import type { Logger } from './errors';
import type { RateLimiter } from './http/rate-limit';
import type { ServerStore } from './store/types';
import type { WebhookSecurity } from './runtime/webhook-guard';
import type { MailTemplates } from './templates';

/**
 * A sender credential: the secret itself, or its SHA-256 (hex) so the plain key never has to be
 * in the server's configuration. Either way the server keeps only the hash.
 */
export type ApiKey =
  | {
      /** Shown in logs and used to scope idempotency keys and rate limits. Never the secret. */
      id: string;
      key: string;
    }
  | {
      id: string;
      /** `sha256(key)` as 64 hex characters, for example from `printf %s "$KEY" | sha256sum`. */
      sha256: string;
    };

export interface SealerOptions {
  /** PKCS#12 file with the operator certificate and private key. */
  p12: Uint8Array;
  passphrase: string;
  reason?: string;
  location?: string;
  /**
   * Seal with an RSA key under 2048 bits or a certificate signed with SHA-1. For local
   * development with throwaway keys only; by default the server refuses to start with one.
   */
  allowWeakKey?: boolean;
  /**
   * Other certificates whose seals this server accepts when verifying, besides the current
   * key's: earlier operator certificates after a rotation, or a root CA.
   */
  trust?: SealTrust;
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
  /** OTP codes one recipient can ever be sent for one envelope. Default 10. */
  otpCodesPerRecipient?: number;
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
  /**
   * The signing page, without a token. `GET /sign/:token` stores the token in an HttpOnly
   * cookie and redirects here; the page then calls `/v1/sign/link/...`. Default
   * `${publicUrl}/sign`.
   */
  signingPageUrl?: string;
  limits?: Limits;
  /**
   * Webhook targets. URLs must be https on a public host name; each delivery resolves the
   * host, refuses private, loopback, link-local and reserved addresses, and connects to the
   * address it checked. Relax this for local development with `webhookSecurity`.
   */
  webhooks?: WebhookTarget[];
  webhookSecurity?: WebhookSecurity;
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
  /** Receives errors, warnings and (with `accessLog`) one line per request, all redacted. */
  logger?: Logger;
  /**
   * Log one line per request to `logger.info`: method, path with the signing token replaced by
   * `:token` and no query string, status and duration. Off by default.
   */
  accessLog?: boolean;
  /**
   * Sends webhooks through this `fetch` instead of the built-in client. The URL and resolved
   * addresses are still checked, but the connection cannot be pinned to the checked address.
   */
  fetch?: typeof fetch;
  /** PDF reading, drawing and sealing. Defaults to `@codevibe_technology/sign-pdf`. */
  pdf?: PdfEngine;
}
