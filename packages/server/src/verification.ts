import {
  SignError,
  verifyChain,
  type AuditAction,
  type AuthMethod,
  type Id,
  type RecipientRole,
  type RecipientStatus,
} from '@codevibe_technology/sign-core';
import { maskEmail, maskPhone } from '@codevibe_technology/sign-pdf';
import { sha256Hex } from './crypto';
import type { SealCheck, SignatureSummary } from './engine';
import type { Runtime } from './runtime/context';
import { sealedFileKey } from './runtime/seal';

/** Why a file is not a valid sealed document of this server. */
export type VerificationFailure =
  | 'not_sealed'
  | 'multiple_signatures'
  | 'signature_invalid'
  | 'earlier_signature_invalid'
  | 'content_between_signatures'
  | 'not_whole_document'
  | 'untrusted_signer'
  | 'unreadable'
  | 'unknown_document';

/** Each check in the order it is made; null when an earlier one failed, so it was not reached. */
export interface SealChecks {
  /** The file carries a seal. */
  sealed: boolean | null;
  /** It carries the seal alone, or the seal over signatures made before it. */
  singleSignature: boolean | null;
  /** The signature is intact: no byte it covers changed. */
  intact: boolean | null;
  /** The signature covers the whole file: nothing was added after sealing. */
  coversWholeDocument: boolean | null;
  /** The seal was made with this server's certificate, or one it trusts. */
  trustedCertificate: boolean | null;
}

export interface VerifiedRecipient {
  name: string;
  /** Masked the way the signing certificate prints it, for example a****@example.com. */
  contact: string | null;
  role: RecipientRole;
  status: RecipientStatus;
  auth: AuthMethod;
  actedAt: string | null;
  /** The eSign provider an Aadhaar signer signed through, for example `leegality`. */
  esign?: { provider: string; sandbox?: boolean };
}

/** The envelope a valid sealed file belongs to: what its certificate page already prints. */
export interface VerifiedEnvelope {
  id: Id;
  title: string;
  documentId: Id;
  documentName: string;
  sentAt: string | null;
  completedAt: string | null;
  recipients: VerifiedRecipient[];
  events: { seq: number; action: AuditAction; at: string; recipient: string | null }[];
  /** `head` is the last hash of the audit chain, when the chain is intact. */
  chain: { valid: boolean; head: string | null; events: number };
}

/** A signature made before the seal, for example an Aadhaar eSign by an eSign provider. */
export interface EarlierSignature {
  /** The signature matches the bytes it covers. */
  valid: boolean;
  signerCommonName: string | null;
  /** The authority that issued the signer's certificate. */
  issuerCommonName: string | null;
  signedAt: string | null;
}

export interface PublicVerification {
  /** The file is exactly what this server sealed, unchanged since. */
  valid: boolean;
  /** The first check that failed; null when valid. */
  reason: VerificationFailure | null;
  /** SHA-256 of the file, lowercase hex. */
  sha256: string;
  checks: SealChecks;
  signer: { commonName: string | null; organization: string | null } | null;
  signedAt: string | null;
  /** SHA-256 of the certificate the seal was made with. */
  certificateSha256: string | null;
  /**
   * `operator`: the file ends with this server's seal. `provider_only`: an eSign provider
   * locked the file against further signatures, so it is kept as the provider signed it and
   * is recognised by its SHA-256 in the audit trail.
   */
  seal: 'operator' | 'provider_only';
  /** Signatures made before the seal, earliest first. Empty for most files. */
  earlierSignatures: EarlierSignature[];
  /** Present only for a valid file whose envelope this server still holds. */
  envelope: VerifiedEnvelope | null;
}

const ORDER = [
  'sealed',
  'singleSignature',
  'intact',
  'coversWholeDocument',
  'trustedCertificate',
] as const satisfies readonly (keyof SealChecks)[];

const FAILED_CHECK: Partial<Record<VerificationFailure, keyof SealChecks>> = {
  not_sealed: 'sealed',
  multiple_signatures: 'singleSignature',
  signature_invalid: 'intact',
  earlier_signature_invalid: 'intact',
  content_between_signatures: 'intact',
  not_whole_document: 'coversWholeDocument',
  untrusted_signer: 'trustedCertificate',
};

function checksFor(reason: VerificationFailure | null): SealChecks {
  const failed = reason ? FAILED_CHECK[reason] : undefined;
  const reached = reason === null ? ORDER.length : failed ? ORDER.indexOf(failed) : 0;
  const checks = {} as SealChecks;
  ORDER.forEach((name, i) => {
    checks[name] = i < reached ? true : name === failed ? false : null;
  });
  return checks;
}

function result(sha256: string, reason: VerificationFailure | null, check?: SealCheck) {
  return {
    valid: reason === null,
    reason,
    sha256,
    checks: checksFor(reason),
    signer: check?.signer
      ? {
          commonName: check.signer.commonName ?? null,
          organization: check.signer.organization ?? null,
        }
      : null,
    signedAt: check?.signedAt ?? null,
    certificateSha256: check?.certificateSha256 ?? null,
    seal: 'operator',
    earlierSignatures: (check?.earlierSignatures ?? []).map(earlier),
    envelope: null,
  } satisfies PublicVerification;
}

export const earlier = (signature: SignatureSummary): EarlierSignature => ({
  valid: signature.valid,
  signerCommonName: signature.signer?.commonName ?? null,
  issuerCommonName: signature.issuer?.commonName ?? null,
  signedAt: signature.signedAt ?? null,
});

/** What the audit trail says about how the file with this hash was sealed. */
async function sealRecord(rt: Runtime, sha256: string) {
  const ref = await rt.store.findSealed?.(sha256);
  if (!ref) return null;
  const events = await rt.store.listEvents(ref.envelopeId);
  return (
    events.find((e) => e.action === 'document.sealed' && e.data?.sha256 === sha256)?.data ?? null
  );
}

/**
 * A file this server recorded as sealed, byte for byte, that `verify` cannot vouch for on its
 * own: one the provider locked, or one whose provider signature is in a form it cannot read.
 */
export async function recordedAsIs(
  rt: Runtime,
  bytes: Uint8Array,
  sha256: string,
  check: SealCheck,
): Promise<PublicVerification | null> {
  const record = await sealRecord(rt, sha256);
  if (record?.seal === 'provider_only') {
    const signatures = (await rt.pdf.verifySignatures?.(bytes).catch(() => [])) ?? [];
    return {
      ...result(sha256, null),
      seal: 'provider_only',
      earlierSignatures: signatures.map(earlier),
      envelope: await envelopeOf(rt, sha256),
    };
  }
  if (check.reason === 'earlier_signature_invalid' && record?.earlierSignatures === 'unverified') {
    return { ...result(sha256, null, check), envelope: await envelopeOf(rt, sha256) };
  }
  return null;
}

const REASONS = new Set<string>(Object.keys(FAILED_CHECK));

async function envelopeOf(rt: Runtime, sha256: string): Promise<VerifiedEnvelope | null> {
  const ref = await rt.store.findSealed?.(sha256);
  const envelope = ref ? await rt.store.get(ref.envelopeId) : null;
  if (!ref || !envelope) return null;
  const events = await rt.store.listEvents(envelope.id);
  const chain = await verifyChain(events, rt.hasher, {
    envelopeId: envelope.id,
    ...(envelope.auditHead ? { expectedHead: envelope.auditHead } : {}),
  });
  const names = new Map(envelope.recipients.map((r) => [r.id, r.name]));
  return {
    id: envelope.id,
    title: envelope.title,
    documentId: ref.documentId,
    documentName: envelope.documents.find((d) => d.id === ref.documentId)?.name ?? 'Document',
    sentAt: envelope.sentAt ?? null,
    completedAt: envelope.completedAt ?? null,
    recipients: envelope.recipients.map((r) => ({
      name: r.name,
      contact: r.email ? maskEmail(r.email) : r.phone ? maskPhone(r.phone) : null,
      role: r.role,
      status: r.status,
      auth: r.auth,
      actedAt: r.actedAt ?? null,
      ...(r.esign
        ? { esign: { provider: r.esign.provider, ...(r.esign.sandbox ? { sandbox: true } : {}) } }
        : {}),
    })),
    events: events.map((e) => ({
      seq: e.seq,
      action: e.action,
      at: e.at,
      recipient: e.recipientId ? (names.get(e.recipientId) ?? null) : null,
    })),
    chain: { valid: chain.valid, head: chain.valid ? chain.head : null, events: events.length },
  };
}

/**
 * Checks that `bytes` is a file this server sealed and that nothing changed since, and names
 * its envelope when it is. Nothing about the file is stored. Refuses with `DOCUMENT_TOO_LARGE`
 * or `DOCUMENT_INVALID` what cannot be a sealed PDF at all, and with `RATE_LIMITED` while too
 * many files are being checked.
 */
export async function verifySealedPdf(rt: Runtime, bytes: Uint8Array): Promise<PublicVerification> {
  if (!rt.sealTrust || !rt.pdf.verify) {
    throw new SignError('INVALID_STATE', 'This server cannot verify sealed files');
  }
  if (bytes.byteLength > rt.limits.maxPdfBytes) {
    throw new SignError(
      'DOCUMENT_TOO_LARGE',
      `The file is larger than ${rt.limits.maxPdfBytes} bytes`,
      { maxBytes: rt.limits.maxPdfBytes },
    );
  }
  if (!Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-')) {
    throw new SignError('DOCUMENT_INVALID', 'The file is not a PDF');
  }
  if (rt.verifying.count >= rt.limits.maxConcurrentVerifications) {
    throw new SignError('RATE_LIMITED', 'Too many files are being checked, try again shortly', {
      retryAfterSeconds: 2,
    });
  }
  const sha256 = sha256Hex(bytes);
  let check: SealCheck;
  rt.verifying.count++;
  try {
    check = await rt.pdf.verify(bytes, { trust: rt.sealTrust, allowEarlierSignatures: true });
  } catch {
    // A file the parser refuses or cannot read is not a sealed document; it is not our error.
    return result(sha256, 'unreadable');
  } finally {
    rt.verifying.count--;
  }
  if (!check.valid) {
    const recorded = await recordedAsIs(rt, bytes, sha256, check);
    if (recorded) return recorded;
    const reason = REASONS.has(check.reason ?? '') ? (check.reason as VerificationFailure) : null;
    return result(sha256, reason ?? 'signature_invalid', check);
  }
  return { ...result(sha256, null, check), envelope: await envelopeOf(rt, sha256) };
}

/**
 * The same answer for the sealed file with this SHA-256, read from the server's own storage.
 * A hash this server never sealed answers `unknown_document`.
 */
export async function verifySealedHash(rt: Runtime, hash: string): Promise<PublicVerification> {
  const sha256 = hash.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new SignError('VALIDATION', 'sha256 must be 64 hexadecimal characters', {
      issues: [{ path: 'sha256', message: 'Send the SHA-256 of the sealed PDF as hex' }],
    });
  }
  const ref = await rt.store.findSealed?.(sha256);
  const bytes = ref ? await rt.files.get(sealedFileKey(ref.envelopeId, ref.documentId)) : null;
  if (!bytes || sha256Hex(bytes) !== sha256) return result(sha256, 'unknown_document');
  return verifySealedPdf(rt, bytes);
}
