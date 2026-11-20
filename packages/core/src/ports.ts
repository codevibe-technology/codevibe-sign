import type { AuditEvent, Envelope, Id, Recipient } from './types';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  id(): Id;
}

export interface RandomSource {
  /** Cryptographically secure random bytes. */
  bytes(length: number): Uint8Array;
}

export interface Hasher {
  /** Lowercase hex SHA-256. */
  sha256(data: Uint8Array | string): Promise<string>;
}

export interface EnvelopeStore {
  get(id: Id): Promise<Envelope | null>;
  /** Saves the envelope and appends events atomically. `expectedVersion` guards concurrent writes. */
  save(
    envelope: Envelope,
    events: AuditEvent[],
    expectedVersion?: number,
  ): Promise<{ version: number }>;
  listEvents(envelopeId: Id): Promise<AuditEvent[]>;
  /** Envelopes that need a reminder or expiry check at `now`. */
  due(now: Date, limit: number): Promise<Envelope[]>;
}

export interface FileStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export interface MailMessage {
  to: string;
  /**
   * Display name for the sender, for example the workspace that sent the envelope. The
   * mailer keeps its own address, so SPF and DKIM still pass.
   */
  fromName?: string;
  /** Where replies go, when not to the sender address. */
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
  /** What the message is about, for a mailer that keeps a send log. Never sent. */
  meta?: MailMeta;
}

/**
 * Context for a send log. Holds identifiers and a kind only, so a log built from it never
 * keeps a body, a link or a code.
 */
export interface MailMeta {
  /** For example `invite`, `reminder`, `completed_copy`, `cancelled` or `otp`. */
  kind: string;
  workspaceId?: string;
  envelopeId?: string;
  recipientId?: string;
}

/** What a mailer learned from the provider; `messageId` is the `Message-ID` it used. */
export interface MailReceipt {
  messageId?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<MailReceipt | void>;
}

/** Which envelope a one-time code is for, so the sender can label the message. */
export interface OtpContext {
  envelopeId: string;
  workspaceId?: string;
}

export interface OtpSender {
  send(recipient: Recipient, code: string, context?: OtpContext): Promise<void>;
}
