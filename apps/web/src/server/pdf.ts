import 'server-only';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SignError, type PageSize } from '@codevibe_technology/sign-core';
import { inspectPdf, sealCertificate, verify } from '@codevibe_technology/sign-pdf';
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
      err.code === 'DOCUMENT_TOO_LARGE'
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

const holder = globalThis as unknown as { __cvsSealFingerprint?: string };

/** SHA-256 of this install's seal certificate, read once. */
function sealFingerprint(): string {
  if (holder.__cvsSealFingerprint) return holder.__cvsSealFingerprint;
  const config = env();
  if (!config.SEAL_P12_PATH) {
    throw new AppError(
      'CONFLICT',
      'This install has no seal certificate yet (SEAL_P12_PATH), so nothing can be verified.',
    );
  }
  holder.__cvsSealFingerprint = sealCertificate({
    p12: readFileSync(config.SEAL_P12_PATH),
    passphrase: config.SEAL_PASSPHRASE,
    allowWeakKey: config.SEAL_ALLOW_WEAK_KEY,
  }).sha256;
  return holder.__cvsSealFingerprint;
}

export interface VerifyOutcome {
  valid: boolean;
  /** One plain sentence on what the check found. */
  summary: string;
  reason: string | null;
  signer: string | null;
  signedAt: string | null;
  sha256: string;
}

const REASONS: Record<string, string> = {
  not_sealed:
    'This PDF carries no seal. It is not a document completed in Codevibe Sign, or it was printed or saved again without the seal.',
  signature_invalid: 'The seal is broken: the file was changed after it was sealed.',
  not_whole_document:
    'Something was added to the file after it was sealed, so it is not the original.',
  multiple_signatures:
    'The file carries more than one signature; only a single seal from this workspace is accepted.',
  untrusted_signer:
    'The seal is intact but was made by a different certificate, not by this workspace.',
};

/** Checks that `bytes` is a file this install sealed and that nothing changed since. */
export async function verifyUpload(bytes: Uint8Array): Promise<VerifyOutcome> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new AppError(
      'VALIDATION',
      `The file is larger than ${MAX_PDF_BYTES / MB} MB; sealed documents from this workspace are smaller.`,
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
  const fingerprint = sealFingerprint();
  try {
    const result = await verify(bytes, { trust: { fingerprints: [fingerprint] } });
    const signer = [result.signer?.commonName, result.signer?.organization]
      .filter(Boolean)
      .join(', ');
    return {
      valid: result.valid,
      summary: result.valid
        ? 'Authentic. This is exactly the document sealed by this workspace, unchanged since.'
        : (REASONS[result.reason ?? ''] ?? 'The seal could not be confirmed.'),
      reason: result.reason ?? null,
      signer: signer || null,
      signedAt: result.signedAt ?? null,
      sha256,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    return {
      valid: false,
      summary: 'The file could not be read as a PDF, so its seal cannot be checked.',
      reason: 'unreadable',
      signer: null,
      signedAt: null,
      sha256,
    };
  }
}
