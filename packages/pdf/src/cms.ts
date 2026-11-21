import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { SignError } from '@codevibe_technology/sign-core';

const { asn1, pki } = forge;
const { Class, Type } = asn1;

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signatureTimeStampToken: '1.2.840.113549.1.9.16.2.14',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  sha256WithRSA: '1.2.840.113549.1.1.11',
} as const;

const BAG = {
  key: '1.2.840.113549.1.12.10.1.1',
  shroudedKey: '1.2.840.113549.1.12.10.1.2',
  certificate: '1.2.840.113549.1.12.10.1.3',
} as const;

export interface SigningIdentity {
  key: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
  /** The signing certificate first, then the certificates that issued it, in order. */
  chain: forge.pki.Certificate[];
}

const toBinary = (bytes: Uint8Array) => Buffer.from(bytes).toString('binary');
const fromBinary = (binary: string) => Buffer.from(binary, 'binary');

export function sha256Binary(data: Buffer | string): string {
  const input = typeof data === 'string' ? fromBinary(data) : data;
  return createHash('sha256').update(input).digest('binary');
}

function sameKey(key: forge.pki.rsa.PrivateKey, certificate: forge.pki.Certificate): boolean {
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  return (
    publicKey.n !== undefined &&
    key.n.compareTo(publicKey.n) === 0 &&
    key.e.compareTo(publicKey.e) === 0
  );
}

function selfIssued(certificate: forge.pki.Certificate): boolean {
  try {
    return certificate.isIssuer(certificate);
  } catch {
    return false;
  }
}

function signedBy(child: forge.pki.Certificate, issuer: forge.pki.Certificate): boolean {
  try {
    return issuer.issued(child) && issuer.verify(child);
  } catch {
    return false;
  }
}

/**
 * Orders certificates from the signing certificate up to its root, following verified issuer
 * signatures. Certificates that are not on that path are left out.
 */
export function certificatePath(
  leaf: forge.pki.Certificate,
  candidates: forge.pki.Certificate[],
): forge.pki.Certificate[] {
  const path = [leaf];
  let current = leaf;
  while (!selfIssued(current) && path.length <= candidates.length) {
    const issuer = candidates.find(
      (candidate) => !path.includes(candidate) && signedBy(current, candidate),
    );
    if (!issuer) break;
    path.push(issuer);
    current = issuer;
  }
  return path;
}

/** Opens a PKCS#12 file and finds the RSA key with its matching certificate and issuers. */
export function readP12(p12: Uint8Array, passphrase: string): SigningIdentity {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.createBuffer(toBinary(p12));
    parsed = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(der), false, passphrase);
  } catch {
    throw new SignError(
      'SEAL_FAILED',
      'The sealing certificate could not be opened. Check the PKCS#12 file and its passphrase.',
      { option: 'p12' },
    );
  }

  const bags = (bagType: string): forge.pkcs12.Bag[] => parsed.getBags({ bagType })[bagType] ?? [];
  const keyBags = [...bags(BAG.shroudedKey), ...bags(BAG.key)];
  const key = keyBags.find((bag) => bag.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key || typeof key.sign !== 'function') {
    throw new SignError('SEAL_FAILED', 'The PKCS#12 file has no RSA private key.', {
      option: 'p12',
    });
  }

  const certificates = bags(BAG.certificate)
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => cert !== undefined);
  const certificate = certificates.find((cert) => sameKey(key, cert));
  if (!certificate) {
    throw new SignError('SEAL_FAILED', 'The PKCS#12 file has no certificate for its private key.', {
      option: 'p12',
    });
  }
  return { key, certificate, chain: certificatePath(certificate, certificates) };
}

const MIN_RSA_BITS = 2048;

/** Certificate signature algorithms accepted for a seal certificate: SHA-256 or stronger. */
const STRONG_CERTIFICATE_SIGNATURES = new Set([
  '1.2.840.113549.1.1.10',
  '1.2.840.113549.1.1.11',
  '1.2.840.113549.1.1.12',
  '1.2.840.113549.1.1.13',
]);

/**
 * Extended key usages that allow document signing: documentSigning (RFC 9336), Microsoft
 * document signing, Adobe authentic documents, email protection (common on older document
 * signing certificates) and anyExtendedKeyUsage. forge names the ones it knows.
 */
const DOCUMENT_SIGNING_USAGES = [
  '1.3.6.1.5.5.7.3.36',
  '1.3.6.1.4.1.311.10.3.12',
  '1.2.840.113583.1.1.5',
  'emailProtection',
  '1.3.6.1.5.5.7.3.4',
  '2.5.29.37.0',
];

function refuse(message: string, details: Record<string, unknown>): never {
  throw new SignError('SEAL_FAILED', message, { option: 'p12', ...details });
}

function assertValidAt(certificate: forge.pki.Certificate, at: Date, role: string): void {
  const { notBefore, notAfter } = certificate.validity;
  if (at < notBefore || at > notAfter) {
    refuse(
      `The ${role} is valid from ${notBefore.toISOString()} to ${notAfter.toISOString()}, not at the signing time.`,
      { notBefore: notBefore.toISOString(), notAfter: notAfter.toISOString() },
    );
  }
}

/**
 * Checks what the seal certificate may be used for. A single self-signed certificate is
 * accepted even when it says CA:TRUE, as older installs generated it that way. A certificate
 * issued by a CA must be an end-entity one (CA:FALSE). When key usage or extended key usage
 * are present they must allow signing documents.
 */
function assertSealProfile(certificate: forge.pki.Certificate): void {
  const constraints = certificate.getExtension('basicConstraints') as { cA?: boolean } | null;
  if (constraints?.cA && !selfIssued(certificate)) {
    refuse(
      'The sealing certificate is a CA certificate. Issue a separate seal certificate with CA:FALSE from your root.',
      { reason: 'ca_certificate' },
    );
  }
  const usage = certificate.getExtension('keyUsage') as {
    digitalSignature?: boolean;
    nonRepudiation?: boolean;
  } | null;
  if (usage && !usage.digitalSignature && !usage.nonRepudiation) {
    refuse(
      'The sealing certificate does not allow digital signatures. Its key usage needs digitalSignature and nonRepudiation.',
      { reason: 'key_usage' },
    );
  }
  const extended = certificate.getExtension('extKeyUsage') as Record<string, unknown> | null;
  if (extended && !DOCUMENT_SIGNING_USAGES.some((name) => extended[name] === true)) {
    refuse(
      'The sealing certificate is not for document signing. Its extended key usage needs documentSigning (1.3.6.1.5.5.7.3.36) or msDocumentSigning (1.3.6.1.4.1.311.10.3.12).',
      { reason: 'extended_key_usage' },
    );
  }
}

/**
 * Refuses a chain that should not seal documents: an RSA key under 2048 bits, a certificate
 * signed with SHA-1 or MD5 (unless `allowWeak`), certificates not valid at `at`, a seal
 * certificate whose usage does not allow document signing, and issuers that did not sign the
 * certificate below them. `chain` starts with the seal certificate.
 */
export function assertSealChain(
  chain: forge.pki.Certificate[],
  at: Date,
  allowWeak: boolean,
): void {
  const [certificate, ...issuers] = chain;
  if (!certificate) {
    throw new SignError('SEAL_FAILED', 'The signer returned no seal certificate.', {
      option: 'signer',
    });
  }
  const publicKey = certificate.publicKey as Partial<forge.pki.rsa.PublicKey>;
  if (!publicKey.n) {
    refuse('The sealing certificate does not hold an RSA key.', { reason: 'key_type' });
  }
  const bits = publicKey.n.bitLength();
  if (!allowWeak && bits < MIN_RSA_BITS) {
    refuse(`The sealing key is RSA-${bits}. Use an RSA key of at least ${MIN_RSA_BITS} bits.`, {
      keyBits: bits,
    });
  }
  const algorithm = certificate.signatureOid ?? '';
  if (!allowWeak && !STRONG_CERTIFICATE_SIGNATURES.has(algorithm)) {
    refuse(
      'The sealing certificate is signed with a weak algorithm. Use a certificate signed with SHA-256 or stronger.',
      { signatureAlgorithm: algorithm },
    );
  }
  assertValidAt(certificate, at, 'sealing certificate');
  assertSealProfile(certificate);

  let child = certificate;
  for (const issuer of issuers) {
    if (!signedBy(child, issuer)) {
      refuse('A certificate in the seal chain did not issue the one before it.', {
        reason: 'chain',
      });
    }
    const constraints = issuer.getExtension('basicConstraints') as { cA?: boolean } | null;
    if (!constraints?.cA) {
      refuse('A certificate in the seal chain is not a CA certificate.', { reason: 'chain' });
    }
    assertValidAt(issuer, at, 'issuing certificate of the seal');
    child = issuer;
  }
}

/** `assertSealChain` for an identity read from a PKCS#12 file. */
export function assertSealIdentity(identity: SigningIdentity, at: Date, allowWeak: boolean): void {
  const bits = identity.key.n.bitLength();
  if (!allowWeak && bits < MIN_RSA_BITS) {
    refuse(`The sealing key is RSA-${bits}. Use an RSA key of at least ${MIN_RSA_BITS} bits.`, {
      keyBits: bits,
    });
  }
  assertSealChain(identity.chain, at, allowWeak);
}

export function certificateDer(certificate: forge.pki.Certificate): string {
  return asn1.toDer(pki.certificateToAsn1(certificate)).getBytes();
}

export const oid = (value: string) =>
  asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(value).getBytes());
export const nullValue = () => asn1.create(Class.UNIVERSAL, Type.NULL, false, '');
export const sequence = (items: forge.asn1.Asn1[]) =>
  asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, items);
export const set = (items: forge.asn1.Asn1[]) =>
  asn1.create(Class.UNIVERSAL, Type.SET, true, items);
export const octets = (binary: string) =>
  asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, binary);
export const integer = (binary: string) =>
  asn1.create(Class.UNIVERSAL, Type.INTEGER, false, binary);
export const algorithm = (value: string) => sequence([oid(value), nullValue()]);
export const attribute = (type: string, value: forge.asn1.Asn1) =>
  sequence([oid(type), set([value])]);

/** forge accepts an options object here, though its type definitions only declare a boolean. */
const fromDerWith = asn1.fromDer as unknown as (
  bytes: string,
  options: { strict: boolean; parseAllBytes: boolean; decodeBitStrings: boolean },
) => forge.asn1.Asn1;

/**
 * Parses DER that is embedded again unchanged, such as a timestamp token. Refuses input that
 * would not encode back to the same bytes (BER, trailing data), so nothing it covers shifts.
 */
export function parseDerExact(binary: string): forge.asn1.Asn1 {
  const node = fromDerWith(binary, { strict: true, parseAllBytes: true, decodeBitStrings: false });
  if (asn1.toDer(node).getBytes() !== binary) {
    throw new Error('The structure is not in DER form.');
  }
  return node;
}

/** The certificate's own encoded TBSCertificate fields, so issuer and serial match byte for byte. */
function tbsFields(certificate: forge.pki.Certificate): forge.asn1.Asn1[] {
  const cached = (certificate as { tbsCertificate?: forge.asn1.Asn1 }).tbsCertificate;
  const tbs = cached ?? asn1.fromDer(certificateDer(certificate)).value[0];
  if (!tbs || typeof tbs === 'string') {
    return [];
  }
  const fields = tbs.value as forge.asn1.Asn1[];
  const hasVersion = fields[0]?.tagClass === Class.CONTEXT_SPECIFIC && fields[0]?.type === 0;
  return hasVersion ? fields.slice(1) : fields;
}

export function serialNumber(certificate: forge.pki.Certificate): forge.asn1.Asn1 {
  const serial = tbsFields(certificate)[0];
  return serial ?? integer(forge.util.hexToBytes(certificate.serialNumber));
}

export function issuerName(certificate: forge.pki.Certificate): forge.asn1.Asn1 {
  return tbsFields(certificate)[2] ?? pki.distinguishedNameToAsn1(certificate.issuer);
}

/** ESS signing-certificate-v2, which binds the signer certificate into the signed attributes. */
export function signingCertificateV2(
  certificate: forge.pki.Certificate,
  der = certificateDer(certificate),
): forge.asn1.Asn1 {
  const certHash = sha256Binary(der);
  const issuerSerial = sequence([
    sequence([asn1.create(Class.CONTEXT_SPECIFIC, 4, true, [issuerName(certificate)])]),
    serialNumber(certificate),
  ]);
  return sequence([sequence([sequence([octets(certHash), issuerSerial])])]);
}

/** DER requires the members of a SET OF in ascending order of their encodings. */
export function derSorted(items: forge.asn1.Asn1[]): forge.asn1.Asn1[] {
  return items
    .map((item) => ({ item, der: asn1.toDer(item).getBytes() }))
    .sort((a, b) => (a.der < b.der ? -1 : a.der > b.der ? 1 : 0))
    .map(({ item }) => item);
}

export interface CadesInput {
  /** The seal certificate first, then its issuers. */
  chain: forge.pki.Certificate[];
  /** `chain` as the DER (binary strings) the signer handed over; embedded unchanged. */
  chainDer: string[];
  /** Signs the DER of the signed attributes with SHA-256 and RSA; returns the raw signature. */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /**
   * Returns an RFC 3161 timestamp token (DER) over the signature value, or null to leave the
   * signature without one.
   */
  timestamp?(signature: Uint8Array): Promise<Uint8Array | null>;
}

/**
 * Builds a detached CMS SignedData for PAdES (SubFilter ETSI.CAdES.detached): signed
 * attributes are content-type, message-digest and signing-certificate-v2, which is baseline
 * B-B. With a timestamp token the unsigned attribute signature-time-stamp is added, which
 * makes it B-T. The signing time lives in the signature dictionary's /M entry, as PAdES
 * requires.
 */
export async function buildCadesSignature(content: Buffer, input: CadesInput): Promise<Buffer> {
  const [certificate] = input.chain;
  if (!certificate) {
    throw new SignError('SEAL_FAILED', 'The signer returned no seal certificate.', {
      option: 'signer',
    });
  }
  const signedAttributes = derSorted([
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octets(sha256Binary(content))),
    attribute(OID.signingCertificateV2, signingCertificateV2(certificate, input.chainDer[0])),
  ]);

  const toSign = fromBinary(asn1.toDer(set(signedAttributes)).getBytes());
  const signature = await input.sign(new Uint8Array(toSign));
  const token = input.timestamp ? await input.timestamp(signature) : null;

  const signerInfo = sequence([
    integer(String.fromCharCode(1)),
    sequence([issuerName(certificate), serialNumber(certificate)]),
    algorithm(OID.sha256),
    asn1.create(Class.CONTEXT_SPECIFIC, 0, true, signedAttributes),
    algorithm(OID.sha256WithRSA),
    octets(toBinary(signature)),
    ...(token
      ? [
          asn1.create(Class.CONTEXT_SPECIFIC, 1, true, [
            attribute(OID.signatureTimeStampToken, parseDerExact(toBinary(token))),
          ]),
        ]
      : []),
  ]);

  const signedData = sequence([
    integer(String.fromCharCode(1)),
    set([algorithm(OID.sha256)]),
    sequence([oid(OID.data)]),
    asn1.create(
      Class.CONTEXT_SPECIFIC,
      0,
      true,
      input.chainDer.map((der) => parseDerExact(der)),
    ),
    set([signerInfo]),
  ]);

  const contentInfo = sequence([
    oid(OID.signedData),
    asn1.create(Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);
  return fromBinary(asn1.toDer(contentInfo).getBytes());
}
