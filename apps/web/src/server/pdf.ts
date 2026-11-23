import 'server-only';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SignError, type PageSize } from '@codevibe_technology/sign-core';
import {
  inspectPdf,
  sealCertificate,
  verify,
  type SealCertificate,
} from '@codevibe_technology/sign-pdf';
import { MAX_PDF_BYTES } from '@/lib/send-flow';
import { env } from './env';
import { AppError } from './errors';

const MB = 1024 * 1024;

/** Page sizes of an uploaded PDF, or an `AppError` that says how to fix the file. */
export async function inspectUpload(
  name: string,
  bytes: Uint8Array,
): Promise<{ pageCount: number; pages: PageSize[] }> {
  try {
    return await inspectPdf(bytes, { maxBytes: MAX_PDF_BYTES });
  } catch (err) {
    if (!(err instanceof SignError)) {
      throw new AppError(
        'VALIDATION',
        `${name} could not be read as a PDF. Open it, save it as PDF again and retry.`,
        'file',
      );
    }
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : '';
    const message =
      err.code === 'PDF_ALREADY_SIGNED'
        ? err.message
        : err.code === 'DOCUMENT_TOO_LARGE'
          ? `${name} is larger than ${MAX_PDF_BYTES / MB} MB. Compress it or split it into smaller files.`
          : reason === 'encrypted'
            ? `${name} is password protected. Remove the password (print it to a new PDF) and add it again.`
            : reason === 'empty'
              ? `${name} has no pages.`
              : /not a PDF/i.test(err.message)
                ? `${name} is not a PDF. Save or export it as PDF and add it again.`
                : `${name} could not be read; it may be damaged or too complex. Save it as PDF again and retry.`;
    throw new AppError('VALIDATION', message, 'file');
  }
}

const holder = globalThis as unknown as { __cvsSealCertificate?: SealCertificate };

/** This install's seal certificate (public part only), read once. */
export function installSealCertificate(): SealCertificate {
  if (holder.__cvsSealCertificate) return holder.__cvsSealCertificate;
  const config = env();
  if (!config.SEAL_P12_PATH) {
    throw new AppError(
      'CONFLICT',
      'This install has no seal certificate yet (SEAL_P12_PATH), so nothing can be verified.',
    );
  }
  holder.__cvsSealCertificate = sealCertificate({
    p12: readFileSync(config.SEAL_P12_PATH),
    passphrase: config.SEAL_PASSPHRASE,
    allowWeakKey: config.SEAL_ALLOW_WEAK_KEY,
  });
  return holder.__cvsSealCertificate;
}

/** "6B6E D7EC ..." : a hex fingerprint in groups of four, the way PDF readers show it. */
export function groupFingerprint(hex: string): string {
  return (
    hex
      .replace(/[^0-9a-f]/gi, '')
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join(' ') ?? ''
  );
}

export interface VerifyOutcome {
  valid: boolean;
  /** One plain sentence on what the check found. */
  summary: string;
  reason: string | null;
  signer: string | null;
  signedAt: string | null;
  sha256: string;
  /**
   * `provider_only`: the file is kept exactly as an eSign provider signed it, without a seal
   * of this install, and is recognised by its SHA-256 in the audit trail.
   */
  seal: 'operator' | 'provider_only';
  /** Signatures made before the seal, such as an Aadhaar eSign, earliest first. */
  earlier: EarlierSignatureLine[];
}

export interface EarlierSignatureLine {
  valid: boolean;
  signer: string | null;
  /** The authority that issued the signer's certificate. */
  issuer: string | null;
  signedAt: string | null;
}

/** Who the result speaks for: a workspace in the app, or the install on its public page. */
export type VerifyScope = 'workspace' | 'install';

const SEALER: Record<VerifyScope, string> = {
  workspace: 'this workspace',
  install: 'Codevibe Sign on this site',
};

const reasons = (by: string): Record<string, string> => ({
  not_sealed:
    'This PDF carries no seal. It is not a document completed in Codevibe Sign, or it was printed or saved again without the seal.',
  signature_invalid: 'The seal is broken: the file was changed after it was sealed.',
  not_whole_document:
    'Something was added to the file after it was sealed, so it is not the original.',
  multiple_signatures: `The file carries more than one signature; only a single seal from ${by} is accepted.`,
  untrusted_signer: `The seal is intact but was made by a different certificate, not by ${by}.`,
  earlier_signature_invalid:
    'A signature made before the seal, such as the Aadhaar eSign, is broken: that part of the file was changed.',
});

/** One plain sentence on what a seal check found, for the person who dropped the file. */
export function verifySummary(
  valid: boolean,
  reason: string | null,
  scope: VerifyScope,
  signatures: { seal?: 'operator' | 'provider_only'; earlier?: number } = {},
): string {
  const by = SEALER[scope];
  if (valid && signatures.seal === 'provider_only') {
    return `Authentic. This is exactly the file the eSign provider signed for a document completed by ${by}. The provider locked it against further signatures, so it carries no seal from here and is recognised by its fingerprint in the audit trail.`;
  }
  if (valid && signatures.earlier) {
    return `Authentic. This is exactly the document sealed by ${by}, unchanged since. The signature made before the seal, such as an Aadhaar eSign, is intact too.`;
  }
  if (valid) return `Authentic. This is exactly the document sealed by ${by}, unchanged since.`;
  if (reason === 'unreadable') {
    return 'The file could not be read as a PDF, so its seal cannot be checked.';
  }
  return reasons(by)[reason ?? ''] ?? 'The seal could not be confirmed.';
}

/** Checks that `bytes` is a file this install sealed and that nothing changed since. */
export async function verifyUpload(
  bytes: Uint8Array,
  scope: VerifyScope = 'workspace',
): Promise<VerifyOutcome> {
  const by = SEALER[scope];
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new AppError(
      'VALIDATION',
      `The file is larger than ${MAX_PDF_BYTES / MB} MB; sealed documents from ${by} are smaller.`,
      'file',
    );
  }
  if (!Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-')) {
    throw new AppError(
      'VALIDATION',
      'That file is not a PDF. Drop the PDF you received after signing.',
      'file',
    );
  }
  const fingerprint = installSealCertificate().sha256;
  try {
    const result = await verify(bytes, {
      trust: { fingerprints: [fingerprint] },
      allowEarlierSignatures: true,
    });
    const earlier = (result.earlierSignatures ?? []).map((signature) => ({
      valid: signature.valid,
      signer: signature.signer?.commonName ?? null,
      issuer: signature.issuer?.commonName ?? null,
      signedAt: signature.signedAt ?? null,
    }));
    const signer = [result.signer?.commonName, result.signer?.organization]
      .filter(Boolean)
      .join(', ');
    return {
      valid: result.valid,
      summary: verifySummary(result.valid, result.reason ?? null, scope, {
        earlier: earlier.length,
      }),
      reason: result.reason ?? null,
      signer: signer || null,
      signedAt: result.signedAt ?? null,
      sha256,
      seal: 'operator',
      earlier,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    return {
      valid: false,
      summary: verifySummary(false, 'unreadable', scope),
      reason: 'unreadable',
      signer: null,
      signedAt: null,
      sha256,
      seal: 'operator',
      earlier: [],
    };
  }
}
