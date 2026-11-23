import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { SignError } from '@codevibe_technology/sign-core';
import { assertSealIdentity, certificateDer, readP12 } from './cms';
import { checkParseLimits, type ParseLimits } from './limits';
import {
  examineSeal,
  examineSignatures,
  signatureInfo,
  type SealSigner,
  type SealVerification,
  type SignatureInfo,
} from './verify';

const { asn1, pki } = forge;

/** Certificates a seal may come from. At least one entry is required. */
export interface VerifyTrust {
  /** Operator certificates, PEM or DER. The signer certificate must be one of them. */
  certificates?: (string | Uint8Array)[];
  /** SHA-256 fingerprints of operator certificates, hex (colons and case are ignored). */
  fingerprints?: string[];
  /**
   * Root CA certificates, PEM or DER. The signer certificate must chain to one of them through
   * the certificates embedded in the signature, and be valid at the signing time.
   */
  roots?: (string | Uint8Array)[];
}

export interface VerifyOptions {
  trust: VerifyTrust;
  /** Parser limits, enforced in a worker thread before the file is read. */
  limits?: Partial<ParseLimits>;
  /**
   * Accept a file that carried signatures before it was sealed, as `countersign()` produces:
   * the operator's seal must then be the latest signature and every earlier one must be
   * intact. Default false, where any second signature fails with `multiple_signatures`.
   */
  allowEarlierSignatures?: boolean;
}

export type VerifyFailure =
  | 'not_sealed'
  | 'signature_invalid'
  | 'not_whole_document'
  | 'multiple_signatures'
  | 'earlier_signature_invalid'
  | 'untrusted_signer';

export interface VerifyResult {
  /**
   * The file is exactly what the trusted operator sealed: one signature, cryptographically
   * valid, covering every byte, made with a trusted certificate. With
   * `allowEarlierSignatures`, that signature is the latest one and the earlier ones are intact.
   */
  valid: boolean;
  /** The first check that failed, when `valid` is false. */
  reason?: VerifyFailure;
  signer?: SealSigner;
  signedAt?: string;
  /** SHA-256 of the signer certificate (DER), lowercase hex. */
  certificateSha256?: string;
  /** How the signer certificate was trusted, when it was. */
  trustedBy?: 'certificate' | 'root';
  /** The low-level result for the operator's signature, as `verifySeal` reports one. */
  seal: SealVerification;
  /**
   * The signatures the file carried before the seal, earliest first. Only with
   * `allowEarlierSignatures`, and only when there are any. Their certificates are not
   * checked against `trust`.
   */
  earlierSignatures?: SignatureInfo[];
}

export interface SealCertificate {
  /** The operator certificate, PEM. */
  pem: string;
  /** SHA-256 of the certificate (DER), lowercase hex. Pass it to `verify()` as a fingerprint. */
  sha256: string;
  subject: SealSigner;
  notBefore: string;
  notAfter: string;
}

function toDer(certificate: string | Uint8Array): string {
  if (typeof certificate !== 'string') {
    return Buffer.from(certificate).toString('binary');
  }
  try {
    return certificateDer(pki.certificateFromPem(certificate));
  } catch {
    throw new SignError('VALIDATION', 'A trusted certificate is not a valid PEM certificate.', {
      option: 'trust',
    });
  }
}

function fingerprint(derBinary: string): string {
  return createHash('sha256').update(Buffer.from(derBinary, 'binary')).digest('hex');
}

function normalizeFingerprint(value: string): string {
  return value.replace(/[:\s]/g, '').toLowerCase();
}

function parseDer(derBinary: string): forge.pki.Certificate {
  try {
    return pki.certificateFromAsn1(asn1.fromDer(derBinary));
  } catch {
    throw new SignError('VALIDATION', 'A trusted root is not a valid certificate.', {
      option: 'trust.roots',
    });
  }
}

/** Orders the embedded certificates from the signer up towards a root, as far as they go. */
function buildChain(
  leaf: forge.pki.Certificate,
  embedded: forge.pki.Certificate[],
): forge.pki.Certificate[] {
  const chain = [leaf];
  let current = leaf;
  while (chain.length <= embedded.length) {
    const issuer = embedded.find((candidate) => {
      if (chain.includes(candidate)) {
        return false;
      }
      try {
        return candidate.issued(current);
      } catch {
        return false;
      }
    });
    if (!issuer) {
      break;
    }
    chain.push(issuer);
    current = issuer;
  }
  return chain;
}

function chainsToRoot(
  leafDer: string,
  embedded: forge.pki.Certificate[],
  roots: forge.pki.Certificate[],
  at: Date,
): boolean {
  try {
    const leaf = pki.certificateFromAsn1(asn1.fromDer(leafDer));
    const store = pki.createCaStore(roots);
    return pki.verifyCertificateChain(store, buildChain(leaf, embedded), {
      validityCheckDate: at,
    });
  } catch {
    return false;
  }
}

/**
 * Verifies a sealed PDF against the operator you trust. Valid only when the file has exactly
 * one signature, the signature is cryptographically intact, it covers every byte of the file,
 * and the signer certificate is one of `trust.certificates` / `trust.fingerprints` or chains to
 * one of `trust.roots`. Use this to decide whether a file is genuine; `verifySeal` only checks
 * the maths and accepts a seal made with any key.
 *
 * With `allowEarlierSignatures` the file may carry signatures made before the seal. The seal
 * must then be the latest signature and meet every condition above, and each earlier
 * signature must still match the bytes it covers (`earlier_signature_invalid` otherwise).
 */
export async function verify(bytes: Uint8Array, options: VerifyOptions): Promise<VerifyResult> {
  const trust = options?.trust ?? {};
  const fingerprints = new Set([
    ...(trust.certificates ?? []).map((certificate) => fingerprint(toDer(certificate))),
    ...(trust.fingerprints ?? []).map(normalizeFingerprint),
  ]);
  const roots = (trust.roots ?? []).map((root) => parseDer(toDer(root)));
  if (fingerprints.size === 0 && roots.length === 0) {
    throw new SignError(
      'VALIDATION',
      'verify() needs the trusted operator certificate, its fingerprint or a root certificate.',
      { option: 'trust' },
    );
  }

  await checkParseLimits(bytes, options.limits);
  const all = options.allowEarlierSignatures
    ? await examineSignatures(bytes, { strictLast: true })
    : [];
  const examination = all[all.length - 1] ?? (await examineSeal(bytes));
  const earlier = all.slice(0, -1);
  const seal = examination.result;
  const leafDer = examination.signerCertificateDer;
  const certificateSha256 = leafDer ? fingerprint(leafDer) : undefined;
  const base: VerifyResult = {
    valid: false,
    seal,
    ...(seal.signer ? { signer: seal.signer } : {}),
    ...(seal.signedAt ? { signedAt: seal.signedAt } : {}),
    ...(certificateSha256 ? { certificateSha256 } : {}),
    ...(earlier.length > 0 ? { earlierSignatures: earlier.map(signatureInfo) } : {}),
  };

  if (!seal.sealed) {
    return { ...base, reason: 'not_sealed' };
  }
  if (seal.signatureCount !== 1 && !options.allowEarlierSignatures) {
    return { ...base, reason: 'multiple_signatures' };
  }
  if (!seal.valid || !leafDer || !certificateSha256) {
    return { ...base, reason: 'signature_invalid' };
  }
  if (earlier.some((entry) => !entry.result.valid)) {
    return { ...base, reason: 'earlier_signature_invalid' };
  }
  if (!seal.coversWholeDocument) {
    return { ...base, reason: 'not_whole_document' };
  }
  if (fingerprints.has(certificateSha256)) {
    return { ...base, valid: true, trustedBy: 'certificate' };
  }
  const at = seal.signedAt ? new Date(seal.signedAt) : new Date();
  if (roots.length > 0 && chainsToRoot(leafDer, examination.certificates, roots, at)) {
    return { ...base, valid: true, trustedBy: 'root' };
  }
  return { ...base, reason: 'untrusted_signer' };
}

/**
 * Opens the operator's PKCS#12 file and returns its certificate and fingerprint, with the same
 * checks `seal()` applies (key strength and validity at `at`, default now). Use it at start-up
 * to fail early, and to know which fingerprint `verify()` should trust.
 */
export function sealCertificate(options: {
  p12: Uint8Array;
  passphrase?: string;
  allowWeakKey?: boolean;
  at?: Date;
}): SealCertificate {
  const identity = readP12(options.p12, options.passphrase ?? '');
  assertSealIdentity(identity, options.at ?? new Date(), options.allowWeakKey ?? false);
  const { certificate } = identity;
  const field = (name: string) => {
    const entry = certificate.subject.getField(name) as { value?: unknown } | null;
    return typeof entry?.value === 'string' ? entry.value : undefined;
  };
  const commonName = field('CN');
  const organization = field('O');
  return {
    pem: pki.certificateToPem(certificate),
    sha256: fingerprint(certificateDer(certificate)),
    subject: {
      ...(commonName ? { commonName } : {}),
      ...(organization ? { organization } : {}),
    },
    notBefore: certificate.validity.notBefore.toISOString(),
    notAfter: certificate.validity.notAfter.toISOString(),
  };
}
