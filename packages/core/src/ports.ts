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
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface OtpSender {
  send(recipient: Recipient, code: string): Promise<void>;
}
