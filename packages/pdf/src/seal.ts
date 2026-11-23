import { SignPdf } from '@signpdf/signpdf';
import { Signer } from '@signpdf/utils';
import forge from 'node-forge';
import { SignError } from '@codevibe_technology/sign-core';
import { assertSealChain, buildCadesSignature } from './cms';
import { loadPdf } from './inspect';
import { addSignaturePlaceholder, signatureKind, type SignatureKind } from './placeholder';
import { p12Signer, type SealProvider } from './signer';
import { signatureFieldsOf } from './signatures';
import { requestTimestamp } from './tsa';

export interface SealOptions {
  /**
   * PKCS#12 (.p12 / .pfx) file with the operator's RSA key, its certificate and any issuing
   * CA certificates. Required unless `signer` is given.
   */
  p12?: Uint8Array;
  passphrase?: string;
  /** Where the seal key lives, when it is not a PKCS#12 file. Takes precedence over `p12`. */
  signer?: SealProvider;
  /** Shown by PDF readers as the reason for the signature. */
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Recorded as the signature time (/M). Defaults to now. */
  signingTime?: Date;
  /** Largest accepted input PDF, in bytes. Defaults to 25 MB. */
  maxBytes?: number;
  /**
   * Accept RSA keys shorter than 2048 bits and certificates signed with SHA-1 or MD5. Only for
   * local development with throwaway keys; never in production.
   */
  allowWeakKey?: boolean;
  /**
   * RFC 3161 timestamp authority. When set, the seal carries a signature timestamp
   * (PAdES B-T), so its time no longer rests on this server's clock alone.
   */
  tsaUrl?: string;
  /**
   * Refuse to seal when the timestamp authority fails. Defaults to true when `tsaUrl` is set.
   * When false, the seal is made without a timestamp (B-B) and `onTimestampFailure` is called.
   */
  tsaRequired?: boolean;
  /** Milliseconds to wait for the timestamp authority. Defaults to 15 seconds. */
  tsaTimeoutMs?: number;
  /** Called when an optional timestamp could not be obtained. */
  onTimestampFailure?: (error: SignError) => void;
  /**
   * Make the seal a certification signature (DocMDP, no changes allowed) when it is the first
   * signature in the file. Defaults to true; false makes an approval signature.
   */
  certify?: boolean;
}

export const DEFAULT_REASON = 'Sealed to show the document has not changed since signing';
const MIN_SIGNATURE_BYTES = 8192;
/** Room for a timestamp token: the authority's signed TSTInfo plus its certificate chain. */
const TIMESTAMP_BYTES = 16384;

class CadesSigner extends Signer {
  constructor(private readonly build: (content: Buffer) => Promise<Buffer>) {
    super();
  }

  override async sign(content: Buffer): Promise<Buffer> {
    return this.build(content);
  }
}

/** Room for the CMS structure: the certificate chain plus signature, attributes and slack. */
export function placeholderSize(chainDer: string[], timestamped: boolean): number {
  const chainBytes = chainDer.reduce((total, der) => total + der.length, 0);
  return Math.max(MIN_SIGNATURE_BYTES, chainBytes + 4096) + (timestamped ? TIMESTAMP_BYTES : 0);
}

export function parseCertificate(binary: string): forge.pki.Certificate {
  try {
    return forge.pki.certificateFromAsn1(forge.asn1.fromDer(binary));
  } catch {
    throw new SignError('SEAL_FAILED', 'The signer returned a certificate that is not valid.', {
      option: 'signer',
    });
  }
}

export function sealProvider(options: SealOptions): SealProvider {
  if (options.signer) return options.signer;
  if (!options.p12) {
    throw new SignError('SEAL_FAILED', 'seal() needs a p12 file or a signer.', {
      option: 'p12',
    });
  }
  return p12Signer({ p12: options.p12, passphrase: options.passphrase ?? '' });
}

/** Asks for a timestamp over the signature value, failing closed unless it is optional. */
export function timestamper(options: SealOptions) {
  const url = options.tsaUrl?.trim();
  if (!url) return undefined;
  const required = options.tsaRequired ?? true;
  return async (signature: Uint8Array): Promise<Uint8Array | null> => {
    try {
      return await requestTimestamp(url, signature, {
        ...(options.tsaTimeoutMs ? { timeoutMs: options.tsaTimeoutMs } : {}),
      });
    } catch (error) {
      const failure =
        error instanceof SignError
          ? error
          : new SignError('SEAL_FAILED', 'The timestamp could not be obtained.', {
              option: 'tsaUrl',
            });
      if (required) throw failure;
      options.onTimestampFailure?.(failure);
      return null;
    }
  };
}

/**
 * Applies a PAdES seal (ETSI.CAdES.detached, SHA-256, RSA) with the operator's certificate:
 * baseline B-B, or B-T when `tsaUrl` is set. The seal covers the whole file and, as the first
 * signature, certifies it with DocMDP (no changes allowed); any later change makes the seal
 * invalid. Refuses RSA keys under 2048 bits, certificates signed with anything weaker than
 * SHA-256, certificates not valid at the signing time or not meant for document signing, and
 * files that already carry signatures (`PDF_ALREADY_SIGNED`; use `countersign()` for those).
 */
export async function seal(pdfBytes: Uint8Array, options: SealOptions): Promise<Uint8Array> {
  const signingTime = options.signingTime ?? new Date();
  const signer = sealProvider(options);
  const chainDer = (await signer.certificateChain()).map((der) =>
    Buffer.from(der).toString('binary'),
  );
  const chain = chainDer.map(parseCertificate);
  assertSealChain(chain, signingTime, options.allowWeakKey ?? false);

  const doc = await loadPdf(pdfBytes, { maxBytes: options.maxBytes });
  // Sealing writes the whole file again, which would destroy existing signatures (an Aadhaar
  // eSign from an ESP, for example). `countersign()` seals such a file with an incremental
  // update instead, so it is refused here.
  const existing = signatureFieldsOf(doc).length;
  if (existing > 0) {
    throw new SignError(
      'PDF_ALREADY_SIGNED',
      'The PDF already carries digital signatures. Sealing writes the file again and would remove them.',
      { signatureCount: existing, step: 'seal' },
    );
  }
  const kind: SignatureKind = signatureKind(existing, options.certify ?? true);
  const timestamp = timestamper(options);
  const commonName = chain[0]!.subject.getField('CN') as { value?: string } | null;

  try {
    addSignaturePlaceholder(doc, {
      kind,
      reason: options.reason ?? DEFAULT_REASON,
      location: options.location ?? '',
      contactInfo: options.contactInfo ?? '',
      name: commonName?.value ?? '',
      signingTime,
      signatureLength: placeholderSize(chainDer, timestamp !== undefined),
    });
    const prepared = await doc.save({ useObjectStreams: false });
    const cades = new CadesSigner((content) =>
      buildCadesSignature(content, {
        chain,
        chainDer,
        sign: (data) => signer.sign(data),
        ...(timestamp ? { timestamp } : {}),
      }),
    );
    const signed = await new SignPdf().sign(Buffer.from(prepared), cades, signingTime);
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
