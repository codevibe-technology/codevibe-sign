import type {
  AuditAction,
  AuthMethod,
  EnvelopeStatus,
  RecipientRole,
  RecipientStatus,
} from '@codevibe_technology/sign-core';

/** A record id: 18 random bytes as base64url. Longer ones are accepted for later. */
const RECORD_ID = /^[A-Za-z0-9_-]{22,64}$/;

export const isRecordId = (value: string) => RECORD_ID.test(value);

/** The record id in what someone pasted or scanned: the link, or the code at its end. */
export function parseRecordId(input: string): string | null {
  const text = input.trim();
  const inLink = /\/r\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/.exec(text);
  const candidate = inLink?.[1] ?? text;
  return isRecordId(candidate) ? candidate : null;
}

export const recordPath = (id: string) => `/r/${id}`;

export type SealState = 'verified' | 'failed' | 'pending';

export interface PublicRecordDocument {
  name: string;
  pageCount: number;
  /** SHA-256 of the file as it was sent for signing: the fingerprint the certificate prints. */
  sha256: string;
  /** SHA-256 of the signed, sealed file. */
  sealedSha256: string | null;
  seal: SealState;
  sealedAt: string | null;
}

export interface PublicRecordSigner {
  name: string;
  /** Masked, for example a****@example.com. */
  contact: string | null;
  role: RecipientRole;
  status: RecipientStatus;
  auth: AuthMethod;
  /** The eSign provider, for a signer who signed with Aadhaar eSign. */
  esign?: { provider: string };
  actedAt: string | null;
}

export interface PublicRecordEvent {
  seq: number;
  action: AuditAction;
  at: string;
  /** A name, or a role such as "Sender"; an email address is masked. */
  actor: string;
  hash: string;
}

/**
 * Everything the public record page and its downloads may show. It never holds an IP address,
 * a browser, a one-time code, a full email address or phone number, a message, a reason
 * someone typed, or anything from inside the document.
 */
export interface PublicRecordView {
  id: string;
  envelopeId: string;
  title: string;
  status: EnvelopeStatus;
  completedAt: string | null;
  sender: { name: string | null; organization: string };
  documents: PublicRecordDocument[];
  signers: PublicRecordSigner[];
  trail: PublicRecordEvent[];
  chain: {
    valid: boolean;
    head: string | null;
    /** The head when the document was sealed: the one its certificate page prints. */
    headAtSealing: string | null;
  };
}
