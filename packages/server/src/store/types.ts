import type {
  AuditEvent,
  Envelope,
  EnvelopeStore,
  Id,
  OtpState,
} from '@codevibe_technology/sign-core';

export interface StoredEnvelope {
  envelope: Envelope;
  /** Starts at 1 on first save and grows by one on every save. */
  version: number;
}

export interface SigningToken {
  /** SHA-256 hex of the token; the token itself is never stored. */
  hash: string;
  envelopeId: Id;
  recipientId: Id;
  expiresAt: Date;
  revokedAt?: Date;
}

export interface OtpChallenge {
  envelopeId: Id;
  recipientId: Id;
  /** From `createOtp` / `verifyOtp` in core: salted hash, expiry and attempts. */
  state: OtpState;
  /** Codes issued to this recipient for this envelope so far, the current one included. */
  issued: number;
  /** Grows on every write; `updateOtp` saves only if it has not moved. */
  version: number;
}

export type IdempotencyClaim =
  | { state: 'new' }
  | { state: 'in_progress' }
  | { state: 'mismatch' }
  | { state: 'replay'; status: number; body: unknown };

export type JobKind = 'notify' | 'webhook' | 'seal';

export interface Job {
  id: Id;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  runAt: Date;
}

/**
 * Everything the server persists. Extends the core `EnvelopeStore` port with signing
 * tokens, OTP challenges, idempotency records and a job outbox.
 *
 * `save` with `expectedVersion` 0 creates the envelope and fails if it exists; any other
 * value must equal the stored version. A mismatch throws `VersionConflictError`.
 * `due` returns active envelopes whose `nextTickAt` (from core) has passed.
 */
export interface ServerStore extends EnvelopeStore {
  load(id: Id): Promise<StoredEnvelope | null>;
  /**
   * Like `save`, and enqueues `jobs` in the same transaction. `expectedVersion` is required:
   * 0 to create, otherwise the version that was loaded. Each event's `seq` must be new for
   * its envelope.
   */
  commit(
    envelope: Envelope,
    events: AuditEvent[],
    expectedVersion: number,
    jobs: Job[],
  ): Promise<{ version: number }>;
  /** Hides an active envelope from `due` until `until`, or until it is saved again. */
  deferCheck(id: Id, until: Date): Promise<void>;

  putToken(token: SigningToken): Promise<void>;
  findToken(hash: string): Promise<SigningToken | null>;
  revokeTokens(envelopeId: Id, recipientId: Id | undefined, at: Date): Promise<void>;

  /**
   * Replaces the recipient's challenge with a newly issued code, so the previous code stops
   * working, and counts it. Returns null without changing anything when `maxIssued` codes have
   * already been issued for this recipient and envelope. Atomic.
   */
  issueOtp(
    challenge: Pick<OtpChallenge, 'envelopeId' | 'recipientId' | 'state'>,
    maxIssued: number,
  ): Promise<OtpChallenge | null>;
  getOtp(envelopeId: Id, recipientId: Id): Promise<OtpChallenge | null>;
  /**
   * Saves `state` for the challenge only if its version is still `challenge.version`, and
   * reports whether it did. Two checks racing on the same code can then never both count as
   * the first attempt.
   */
  updateOtp(challenge: OtpChallenge, state: OtpState): Promise<boolean>;

  claimIdempotency(
    scope: string,
    key: string,
    fingerprint: string,
    now: Date,
  ): Promise<IdempotencyClaim>;
  completeIdempotency(scope: string, key: string, status: number, body: unknown): Promise<void>;
  releaseIdempotency(scope: string, key: string): Promise<void>;

  enqueue(jobs: Job[]): Promise<void>;
  /** Returns up to `limit` due jobs and pushes their `runAt` past `leaseUntil` so no one else takes them. */
  claimJobs(now: Date, limit: number, leaseUntil: Date): Promise<Job[]>;
  completeJob(id: Id): Promise<void>;
  /** Schedules a retry at `retryAt`, or gives up when it is null. */
  failJob(id: Id, error: string, retryAt: Date | null): Promise<void>;

  /**
   * Removes expired tokens, idempotency records older than `idempotencyBefore` and finished
   * jobs. OTP challenges stay until their envelope is final, because they carry the count of
   * codes issued.
   */
  purge(now: Date, idempotencyBefore: Date): Promise<void>;
}
