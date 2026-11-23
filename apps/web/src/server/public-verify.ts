import 'server-only';
import type {
  AuditAction,
  AuthMethod,
  RecipientRole,
  RecipientStatus,
} from '@codevibe_technology/sign-core';
import type { PublicVerification } from '@codevibe_technology/sign-server';
import { verifySummary, type VerifyOutcome } from './pdf';

export interface EvidenceRecipient {
  name: string;
  /** Masked the way the signing certificate prints it, for example a****@example.com. */
  contact: string | null;
  role: RecipientRole;
  status: RecipientStatus;
  auth: AuthMethod;
  actedAt: string | null;
}

export interface EvidenceEvent {
  seq: number;
  action: AuditAction;
  at: string;
  /** Name of the recipient the event is about, when there is one. */
  recipient: string | null;
}

/**
 * What the public verify page shows for a file this install sealed: the same facts the
 * certificate page inside the file prints, without IP addresses or browsers.
 */
export interface SealedEvidence {
  title: string;
  documentName: string;
  sentAt: string | null;
  completedAt: string | null;
  recipients: EvidenceRecipient[];
  events: EvidenceEvent[];
  chain: { valid: boolean; head: string | null; events: number };
}

/**
 * The answer of the sign server's public verification, the one `POST /api/v1/verify` gives,
 * in the words and shape of the verify page.
 */
export function pageOutcome(
  result: PublicVerification,
): VerifyOutcome & { evidence: SealedEvidence | null } {
  const signer = [result.signer?.commonName, result.signer?.organization]
    .filter(Boolean)
    .join(', ');
  const { envelope } = result;
  return {
    valid: result.valid,
    summary: verifySummary(result.valid, result.reason, 'install'),
    reason: result.reason,
    signer: signer || null,
    signedAt: result.signedAt,
    sha256: result.sha256,
    evidence: envelope
      ? {
          title: envelope.title,
          documentName: envelope.documentName,
          sentAt: envelope.sentAt,
          completedAt: envelope.completedAt,
          recipients: envelope.recipients,
          events: envelope.events,
          chain: envelope.chain,
        }
      : null,
  };
}
