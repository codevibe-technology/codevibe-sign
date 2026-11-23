import type {
  AuditEvent,
  Envelope,
  EnvelopeStatus,
  EnvelopeStore,
  Id,
  OtpState,
} from '@codevibe_technology/sign-core';
import type { Template } from '../template';

export interface StoredEnvelope {
  envelope: Envelope;
  /** Starts at 1 on first save and grows by one on every save. */
  version: number;
  /**
   * The workspace that owns the envelope, fixed when it is created. A store that predates
   * workspaces may leave it out; the envelope then belongs to `DEFAULT_WORKSPACE`.
   */
  workspaceId?: string;
}

export interface CommitOptions {
  /** Owner of a new envelope (`expectedVersion` 0). Ignored on later saves. Default `DEFAULT_WORKSPACE`. */
  workspaceId?: string;
}

export interface EnvelopeListQuery {
  /** Only envelopes in one of these states. */
  status?: EnvelopeStatus[];
  /** Case-insensitive match anywhere in the title. */
  search?: string;
  /** Page size, 1 to 100. */
  limit: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
}

export interface EnvelopePage {
  /** Newest first. */
  envelopes: Envelope[];
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface TemplateListQuery {
  /** Case-insensitive match anywhere in the name. */
  search?: string;
  /** Page size, 1 to 100. */
  limit: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
}

export interface TemplatePage {
  /** Newest first. */
  templates: Template[];
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * Where templates are kept. Every method takes the workspace, and a template in another
 * workspace must look exactly like one that does not exist.
 */
export interface TemplateStore {
  /** Saves a new template. May refuse with an `HttpError`, for example over a quota. */
  insert(workspaceId: string, template: Template): Promise<void>;
  get(workspaceId: string, id: Id): Promise<Template | null>;
  list(workspaceId: string, query: TemplateListQuery): Promise<TemplatePage>;
  /**
   * Saves `template` over the stored one only if that one's `updatedAt` is still
   * `expectedUpdatedAt`, and reports whether it did.
   */
  replace(workspaceId: string, template: Template, expectedUpdatedAt: string): Promise<boolean>;
  /** Reports whether there was a template to remove. */
  remove(workspaceId: string, id: Id): Promise<boolean>;
}

/** Which envelope a sealed file belongs to; see `findSealed`. */
export interface SealedDocumentRef {
  envelopeId: Id;
  documentId: Id;
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
    options?: CommitOptions,
  ): Promise<{ version: number }>;
  /**
   * One page of a workspace's envelopes, newest first. Optional for custom stores;
   * `GET /v1/envelopes` needs it.
   */
  list?(workspaceId: string, query: EnvelopeListQuery): Promise<EnvelopePage>;
  /**
   * The sealed document whose file has exactly this SHA-256 (lowercase hex), in any workspace.
   * Optional for custom stores; the public verify routes need it to name the envelope.
   */
  findSealed?(sha256: string): Promise<SealedDocumentRef | null>;
  /** Templates. Optional for custom stores; the `/v1/templates` routes need it. */
  templateStore?: TemplateStore;
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
