import type { EsignProvider } from '@codevibe_technology/sign-aadhaar';
import type { AuditContext, FieldValue, Id } from '@codevibe_technology/sign-core';

/**
 * `starting`: the provider has not answered yet. `pending`: the signer is at the provider.
 * `superseded`: the signer started again with other values, but the provider could still
 * sign this request, so what `onStart` reserved for it is kept until it runs out.
 * `cancelled`: the recipient was replaced; a signature on it is never applied, and
 * `orphaned` records that the provider reported one all the same.
 * The rest are final, except that a session that was superseded, expired or failed still
 * turns `signed` when the provider later reports the signature.
 */
export type EsignSessionStatus =
  | 'starting'
  | 'pending'
  | 'superseded'
  | 'cancelled'
  | 'orphaned'
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
  /** The provider's test environment was used. */
  sandbox?: boolean;
  /** Hash of the signing link that started the session. */
  tokenHash?: string;
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
  /** Every session of a recipient, newest first. */
  list(envelopeId: Id, recipientId: Id): Promise<EsignSession[]>;
  /** The `starting`, `pending` and `superseded` sessions of an envelope. */
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
  /**
   * Sessions that are `starting`, `pending` or `superseded` past `expiresAt`, and ended ones
   * `onEnd` has not heard about, oldest first.
   */
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
   * The provider account a request that already started signs with, when that can differ from
   * what `provider` answers now: the workspace changed accounts or lost the right to one
   * since. Asked after `onStart`, and for every callback, status check and download of the
   * request. Without it `provider` is asked.
   */
  providerForSession?(input: EsignHookInput): Promise<EsignProvider | null>;
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
   * the provider reports a signature after the server stopped waiting; it also arrives for a
   * request whose recipient was replaced meanwhile, which the provider signed all the same.
   */
  onEnd?(input: EsignHookInput & { outcome: EsignOutcome }): Promise<void>;
  /**
   * The provider reference a webhook body names, before anything is verified. Needed for a
   * provider other than Leegality that has no `webhookRef` of its own on a shared instance.
   */
  webhookRef?(provider: string, rawBody: string): string | null;
  /**
   * How long the server waits for a started eSign, and keeps what `onStart` reserved for it.
   * Set it at least as long as the provider keeps its signing page open. Default 24 hours.
   */
  sessionTtlMs?: number;
  /**
   * Accept a provider file whose signature this server cannot read, and seal over it with
   * that noted. By default such a file fails the eSign. The file must always end with the
   * provider's signature.
   */
  acceptUnreadableSignatures?: boolean;
}
