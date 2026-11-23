import type { EsignProvider } from '@codevibe_technology/sign-aadhaar';
import type { AuditContext, FieldValue, Id } from '@codevibe_technology/sign-core';

/**
 * `starting`: the provider has not answered yet. `pending`: the signer is at the provider.
 * The rest are final, except that a session that expired or failed still turns `signed`
 * when the provider later reports the signature.
 */
export type EsignSessionStatus =
  | 'starting'
  | 'pending'
  | 'signed'
  | 'declined'
  | 'expired'
  | 'failed';

/** How a session ended, as `onEnd` hears it. */
export type EsignOutcome = 'signed' | 'declined' | 'expired' | 'failed';

/** What the server read from the signature the provider put on the file. */
export interface EsignSignature {
  /** The signature matched the bytes it covers when the file was fetched. */
  intact: boolean;
  /** Subject common name of the signing certificate. */
  signerCommonName?: string;
  /** Common name of the authority that issued it. */
  issuerCommonName?: string;
  /** SHA-256 of the signing certificate, lowercase hex. */
  certificateSha256?: string;
  signedAt?: string;
}

/** One trip of a recipient to the eSign provider. */
export interface EsignSession {
  /** Also the reference given to the provider and to `onStart` and `onEnd`. */
  id: Id;
  workspaceId: string;
  envelopeId: Id;
  recipientId: Id;
  documentId: Id;
  /** The provider's `name`. */
  provider: string;
  /** The provider's id for the request; null until it answers. */
  providerRef: string | null;
  signUrl: string | null;
  status: EsignSessionStatus;
  /** The signer's field values, drawn on the file the provider signs. */
  values: FieldValue[];
  context?: AuditContext;
  /** The signer's name as the provider reported it. */
  signerName?: string;
  signature?: EsignSignature;
  /** How the session ended, until `onEnd` has heard it. */
  unsettled?: EsignOutcome;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface EsignSessionPatch {
  signerName?: string;
  signature?: EsignSignature;
  /** Set to hand the outcome to `onEnd`; null once it has heard it. */
  unsettled?: EsignOutcome | null;
}

/**
 * Where eSign sessions are kept. A recipient has at most one session that is `starting` or
 * `pending`, and a provider reference names at most one session.
 */
export interface EsignSessionStore {
  /**
   * Saves a new `starting` session. Answers false, saving nothing, when the recipient
   * already has an open one.
   */
  insert(session: EsignSession): Promise<boolean>;
  /** Moves a `starting` session to `pending` with what the provider answered. */
  activate(
    id: Id,
    input: { providerRef: string; signUrl: string; expiresAt: Date; at: Date },
  ): Promise<boolean>;
  get(id: Id): Promise<EsignSession | null>;
  findByRef(provider: string, providerRef: string): Promise<EsignSession | null>;
  /** The recipient's newest session, whatever its status. */
  latest(envelopeId: Id, recipientId: Id): Promise<EsignSession | null>;
  /** The `starting` and `pending` sessions of an envelope. */
  open(envelopeId: Id): Promise<EsignSession[]>;
  /**
   * Sets the status only if it is still one of `from`, and reports whether it did. Every
   * outcome goes through this, so two reports of the same result act once.
   */
  transition(
    id: Id,
    from: readonly EsignSessionStatus[],
    to: EsignSessionStatus,
    at: Date,
    patch?: EsignSessionPatch,
  ): Promise<boolean>;
  /** Clears `unsettled` once `onEnd` has heard the outcome. */
  settle(id: Id): Promise<void>;
  /** Open sessions past `expiresAt`, and ended ones `onEnd` has not heard about, oldest first. */
  due(now: Date, limit: number): Promise<EsignSession[]>;
}

/** Why a workspace cannot use Aadhaar eSign right now. */
export interface EsignUnavailable {
  /** A stable word for programs, for example `no_credits` or `not_configured`. */
  reason: string;
  /** For the sender. */
  message: string;
  /** For the person signing, who cannot fix it. Defaults to a general sentence. */
  signerMessage?: string;
}

export interface EsignHookInput {
  workspaceId: string;
  envelopeId: Id;
  recipientId: Id;
  /** The session id; the same value on `onStart` and `onEnd`. */
  ref: string;
}

/** Aadhaar eSign through an eSign provider, for recipients with `auth: 'aadhaar'`. */
export interface EsignOptions {
  /**
   * The provider a workspace signs with: your account, or the workspace's own. Null when it
   * has none.
   */
  provider(workspaceId: string): Promise<EsignProvider | null>;
  /**
   * Why this workspace cannot start an eSign now, or null. Asked when an envelope with an
   * Aadhaar signer is sent and again when the signer starts.
   */
  available?(workspaceId: string): Promise<EsignUnavailable | null>;
  /**
   * Called before the provider, for example to reserve what the eSign will cost. Throw
   * `SignError('ESIGN_UNAVAILABLE', message, { reason })` to refuse; the message is shown to
   * the signer.
   */
  onStart?(input: EsignHookInput): Promise<void>;
  /**
   * Called when a session ends. A failure is retried by `tick()`, so make it idempotent on
   * `ref` and `outcome`. `signed` can follow `expired` or `failed` for the same `ref`, when
   * the provider reports a signature after the server stopped waiting.
   */
  onEnd?(input: EsignHookInput & { outcome: EsignOutcome }): Promise<void>;
  /**
   * The provider reference a webhook body names, before anything is verified. Needed for a
   * provider other than Leegality that has no `webhookRef` of its own on a shared instance.
   */
  webhookRef?(provider: string, rawBody: string): string | null;
  /** How long the server waits for a started eSign. Default 24 hours. */
  sessionTtlMs?: number;
}
