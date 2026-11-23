import type {
  Clock,
  FileStore,
  Hasher,
  IdGenerator,
  Mailer,
  OtpSender,
  Envelope,
  RandomSource,
} from '@codevibe_technology/sign-core';
import type { CertificateDetails, PdfEngine, SealTrust } from './engine';
import type { Logger } from './errors';
import type { EsignOptions } from './esign/types';
import type { RateLimiter } from './http/rate-limit';
import type { ServerStore, TemplateStore } from './store/types';
import type { Principal } from './tenancy';
import type { WebhookSecurity } from './runtime/webhook-guard';
import type { MailTemplates, WorkspaceMail } from './templates';

/**
 * A sender credential: the secret itself, or its SHA-256 (hex) so the plain key never has to be
 * in the server's configuration. Either way the server keeps only the hash.
 */
export type ApiKey =
  | {
      /** Shown in logs and used to scope idempotency keys and rate limits. Never the secret. */
      id: string;
      key: string;
      /** The workspace this key acts in. Default `DEFAULT_WORKSPACE`. */
      workspaceId?: string;
    }
  | {
      id: string;
      /** `sha256(key)` as 64 hex characters, for example from `printf %s "$KEY" | sha256sum`. */
      sha256: string;
      workspaceId?: string;
    };

export interface SealerOptions {
  /** PKCS#12 file with the operator certificate and private key, and any issuing CA. */
  p12: Uint8Array;
  passphrase: string;
  reason?: string;
  location?: string;
  /**
   * RFC 3161 timestamp authority, for example `http://timestamp.digicert.com`. Sealed files
   * then carry a trusted signing time (PAdES B-T).
   */
  tsaUrl?: string;
  /**
   * Fail the seal when the timestamp authority fails, so the job is retried. Default true when
   * `tsaUrl` is set; when false the file is sealed without a timestamp and a warning is logged.
   */
  tsaRequired?: boolean;
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
  /** Public verify requests per 10 minutes from one IP address. Default 30. */
  verifyPer10Minutes?: number;
  /**
   * Public verify requests per 10 minutes from every caller whose address is not known,
   * together. Default 300.
   */
  verifySharedPer10Minutes?: number;
  /** Uploaded files being verified at the same moment; more are asked to retry. Default 4. */
  maxConcurrentVerifications?: number;
}

export type WebhookEvent = string;

export interface WebhookTarget {
  url: string;
  secret: string;
  /** Audit actions to deliver, for example `envelope.completed`; `*` for all. */
  events: WebhookEvent[];
}

/** What happened to one webhook delivery attempt; see `onWebhookDelivery`. */
export interface WebhookDeliveryReport {
  /** The same on every attempt; receivers see it as `id` and `x-codevibe-delivery`. */
  deliveryId: string;
  workspaceId: string;
  url: string;
  /** The `type` in the body, for example `envelope.completed` or `webhook.test`. */
  event: string;
  /** The exact JSON that was (or would have been) posted. */
  body: string;
  /** 1 for the first attempt of a queued delivery; 1 for a test or a manual redelivery. */
  attempt: number;
  /** `skipped`: the workspace has no target with this URL any more, so nothing was sent. */
  outcome: 'delivered' | 'failed' | 'skipped';
  /** The receiver's HTTP status, when it answered. */
  status: number | null;
  error: string | null;
  /** When the server tries again; null when it will not. */
  retryAt: Date | null;
  at: Date;
  durationMs: number;
}

/** What one saved change to an envelope recorded; see `onEnvelopeChange`. */
export interface EnvelopeChange {
  workspaceId: string;
  envelopeId: string;
  /** The audit actions the change appended, in order, for example `recipient.signed`. */
  actions: string[];
}

export interface SignServerOptions {
  store: ServerStore;
  /**
   * Where templates are kept, when not in `store`: for example your own table with your own
   * quotas. Defaults to `store.templateStore`.
   */
  templateStore?: TemplateStore;
  files: FileStore;
  mailer: Mailer;
  otp: OtpSender;
  sealer: SealerOptions;
  /**
   * Sender credentials, checked from `Authorization: Bearer <key>`. May be empty when
   * `authenticate` is set.
   */
  apiKeys: (ApiKey | string)[];
  /**
   * Resolves the caller of a sender route before the configured `apiKeys` are checked, for
   * example from keys kept in your database or from a signed-in user's session. Return null to
   * fall back to `apiKeys`; throw `HttpError('UNAUTHORIZED', ...)` to refuse outright.
   */
  authenticate?: (request: Request) => Promise<Principal | null>;
  /**
   * The webhook targets of a workspace. Read when an event happens and again before each
   * delivery, so a removed target stops receiving and its secret is never stored in a job.
   * The static `webhooks` serve the default workspace.
   */
  webhookTargets?: (workspaceId: string) => Promise<WebhookTarget[]>;
  /**
   * Called after every webhook delivery attempt, including tests and redeliveries, for
   * example to keep a delivery log. Errors it throws are logged and otherwise ignored.
   */
  onWebhookDelivery?: (report: WebhookDeliveryReport) => void | Promise<void>;
  /**
   * Called once an envelope change is saved, with the audit actions it recorded: sent, viewed,
   * signed, declined, completed, sealed, voided, reminded, expired and the rest. For example
   * to tell open pages to refresh. Errors it throws are logged and otherwise ignored.
   */
  onEnvelopeChange?: (change: EnvelopeChange) => void | Promise<void>;
  /**
   * Path prefix the app is served under, for example `/api` when mounted inside another
   * framework. Routes and cookie paths start with it. Default none.
   */
  basePath?: string;
  /**
   * Base URL of the server. Signing links are `${publicUrl}${basePath}/sign/<token>` unless
   * `signingUrl` is set.
   */
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
  /**
   * Per-workspace templates and sender details, read each time an invitation, reminder,
   * completed copy or cancellation is sent for an envelope in that workspace. What it leaves
   * out comes from `templates` and the defaults. Return null to use those unchanged.
   */
  workspaceMail?: (workspaceId: string) => Promise<WorkspaceMail | null>;
  /**
   * A short line printed at the end of the signing certificate of a workspace's envelopes,
   * for example a company registration number. Read when the envelope is sealed.
   */
  certificateNote?: (workspaceId: string) => Promise<string | null>;
  /**
   * The sender to name on the signing certificate and the link to the envelope's record, which
   * is printed as a QR code. Read when a completed envelope is sealed, and when an Aadhaar
   * eSign signer starts, because their file carries the certificate before they sign; it may
   * create the record then, so make it safe to call more than once. Return null, or leave a
   * part out, to print the certificate without it.
   */
  certificateDetails?: (input: {
    workspaceId: string;
    envelope: Envelope;
  }) => Promise<CertificateDetails | null>;
  /**
   * IANA time zone, for example `Asia/Kolkata`, for the dates printed on signed documents:
   * "date signed" fields, the line under each signature, and the local time next to UTC on
   * the certificate page. Default UTC, where someone signing early in the morning in India
   * gets the previous day's date.
   */
  timeZone?: string;
  /**
   * A workspace's own time zone, read when one of its envelopes is sealed, mailed or opened
   * by a signer. Return null to use `timeZone`.
   */
  workspaceTimeZone?: (workspaceId: string) => Promise<string | null>;
  /**
   * Aadhaar eSign for recipients with `auth: 'aadhaar'`. Without it, an envelope with such a
   * recipient cannot be sent.
   */
  esign?: EsignOptions;
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
