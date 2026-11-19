import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { SignError } from '@codevibe/sign-core';
import { buildCadesSignature, certificateDer, readP12, type SigningIdentity } from './cms';
import { loadPdf } from './inspect';

export interface SealOptions {
  /** PKCS#12 (.p12 / .pfx) file with the operator's RSA key and certificate. */
  p12: Uint8Array;
  passphrase?: string;
  /** Shown by PDF readers as the reason for the signature. */
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Recorded as the signature time (/M). Defaults to now. */
  signingTime?: Date;
  /** Largest accepted input PDF, in bytes. Defaults to 25 MB. */
  maxBytes?: number;
}

const DEFAULT_REASON = 'Sealed to show the document has not changed since signing';
const MIN_SIGNATURE_BYTES = 8192;

class CadesSigner extends Signer {
  constructor(private readonly identity: SigningIdentity) {
    super();
  }

  override async sign(content: Buffer): Promise<Buffer> {
    return buildCadesSignature(content, this.identity);
  }
}

/** Room for the CMS structure: the certificate chain plus signature, attributes and slack. */
function placeholderSize(identity: SigningIdentity): number {
  const chainBytes = identity.chain.reduce((total, cert) => total + certificateDer(cert).length, 0);
  return Math.max(MIN_SIGNATURE_BYTES, chainBytes + 4096);
}

/**
 * Applies a PAdES baseline B-B seal (ETSI.CAdES.detached, SHA-256, RSA) with the
 * operator's certificate. The seal covers the whole file; any later change to it
 * makes the seal invalid.
 */
export async function seal(pdfBytes: Uint8Array, options: SealOptions): Promise<Uint8Array> {
  const identity = readP12(options.p12, options.passphrase ?? '');
  const signingTime = options.signingTime ?? new Date();
  const { notBefore, notAfter } = identity.certificate.validity;
  if (signingTime < notBefore || signingTime > notAfter) {
    throw new SignError(
      'SEAL_FAILED',
      `The sealing certificate is valid from ${notBefore.toISOString()} to ${notAfter.toISOString()}, not at the signing time.`,
      { option: 'p12', notBefore: notBefore.toISOString(), notAfter: notAfter.toISOString() },
    );
  }

  const doc = await loadPdf(pdfBytes, { maxBytes: options.maxBytes });
  const commonName = identity.certificate.subject.getField('CN') as { value?: string } | null;

  try {
    pdflibAddPlaceholder({
      pdfDoc: doc,
      reason: options.reason ?? DEFAULT_REASON,
      location: options.location ?? '',
      contactInfo: options.contactInfo ?? '',
      name: commonName?.value ?? '',
      signingTime,
      signatureLength: placeholderSize(identity),
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    });
    const prepared = await doc.save({ useObjectStreams: false });
    const signed = await new SignPdf().sign(
      Buffer.from(prepared),
      new CadesSigner(identity),
      signingTime,
    );
    return new Uint8Array(signed);
  } catch (error) {
    if (error instanceof SignError) {
      throw error;
    }
    throw new SignError('SEAL_FAILED', 'The PDF could not be sealed.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
