import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { SignError } from '@codevibe/sign-core';

const { asn1, pki } = forge;
const { Class, Type } = asn1;

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
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
  /** The signing certificate first, then any CA certificates in the file. */
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

/** Opens a PKCS#12 file and finds the RSA key with its matching certificate. */
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
  return {
    key,
    certificate,
    chain: [certificate, ...certificates.filter((cert) => cert !== certificate)],
  };
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
 * Refuses identities that should not seal documents: RSA keys under 2048 bits, certificates
 * signed with SHA-1 or MD5 (unless `allowWeak`), and certificates not valid at `at`.
 */
export function assertSealIdentity(identity: SigningIdentity, at: Date, allowWeak: boolean): void {
  const bits = identity.key.n.bitLength();
  if (!allowWeak && bits < MIN_RSA_BITS) {
    throw new SignError(
      'SEAL_FAILED',
      `The sealing key is RSA-${bits}. Use an RSA key of at least ${MIN_RSA_BITS} bits.`,
      { option: 'p12', keyBits: bits },
    );
  }
  const algorithm = identity.certificate.signatureOid ?? '';
  if (!allowWeak && !STRONG_CERTIFICATE_SIGNATURES.has(algorithm)) {
    throw new SignError(
      'SEAL_FAILED',
      'The sealing certificate is signed with a weak algorithm. Use a certificate signed with SHA-256 or stronger.',
      { option: 'p12', signatureAlgorithm: algorithm },
    );
  }
  const { notBefore, notAfter } = identity.certificate.validity;
  if (at < notBefore || at > notAfter) {
    throw new SignError(
      'SEAL_FAILED',
      `The sealing certificate is valid from ${notBefore.toISOString()} to ${notAfter.toISOString()}, not at the signing time.`,
      { option: 'p12', notBefore: notBefore.toISOString(), notAfter: notAfter.toISOString() },
    );
  }
}

export function certificateDer(certificate: forge.pki.Certificate): string {
  return asn1.toDer(pki.certificateToAsn1(certificate)).getBytes();
}

const oid = (value: string) =>
  asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(value).getBytes());
const nullValue = () => asn1.create(Class.UNIVERSAL, Type.NULL, false, '');
const sequence = (items: forge.asn1.Asn1[]) =>
  asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, items);
const set = (items: forge.asn1.Asn1[]) => asn1.create(Class.UNIVERSAL, Type.SET, true, items);
const octets = (binary: string) => asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, binary);
const integer = (binary: string) => asn1.create(Class.UNIVERSAL, Type.INTEGER, false, binary);
const algorithm = (value: string) => sequence([oid(value), nullValue()]);
const attribute = (type: string, value: forge.asn1.Asn1) => sequence([oid(type), set([value])]);

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

function serialNumber(certificate: forge.pki.Certificate): forge.asn1.Asn1 {
  const serial = tbsFields(certificate)[0];
  return serial ?? integer(forge.util.hexToBytes(certificate.serialNumber));
}

function issuerName(certificate: forge.pki.Certificate): forge.asn1.Asn1 {
  return tbsFields(certificate)[2] ?? pki.distinguishedNameToAsn1(certificate.issuer);
}

/** ESS signing-certificate-v2, which binds the signer certificate into the signed attributes. */
function signingCertificateV2(certificate: forge.pki.Certificate): forge.asn1.Asn1 {
  const certHash = sha256Binary(certificateDer(certificate));
  const issuerSerial = sequence([
    sequence([asn1.create(Class.CONTEXT_SPECIFIC, 4, true, [issuerName(certificate)])]),
    serialNumber(certificate),
  ]);
  return sequence([sequence([sequence([octets(certHash), issuerSerial])])]);
}

/** DER requires the members of a SET OF in ascending order of their encodings. */
function derSorted(items: forge.asn1.Asn1[]): forge.asn1.Asn1[] {
  return items
    .map((item) => ({ item, der: asn1.toDer(item).getBytes() }))
    .sort((a, b) => (a.der < b.der ? -1 : a.der > b.der ? 1 : 0))
    .map(({ item }) => item);
}

/**
 * Builds a detached CMS SignedData for PAdES baseline B-B (SubFilter ETSI.CAdES.detached):
 * signed attributes are content-type, message-digest and signing-certificate-v2. The
 * signing time lives in the signature dictionary's /M entry, as PAdES requires.
 */
export function buildCadesSignature(content: Buffer, identity: SigningIdentity): Buffer {
  const { key, certificate, chain } = identity;
  const signedAttributes = derSorted([
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octets(sha256Binary(content))),
    attribute(OID.signingCertificateV2, signingCertificateV2(certificate)),
  ]);

  const toSign = asn1.toDer(set(signedAttributes)).getBytes();
  const md = forge.md.sha256.create();
  md.update(toSign);
  const signature = key.sign(md);

  const signerInfo = sequence([
    integer(String.fromCharCode(1)),
    sequence([issuerName(certificate), serialNumber(certificate)]),
    algorithm(OID.sha256),
    asn1.create(Class.CONTEXT_SPECIFIC, 0, true, signedAttributes),
    algorithm(OID.sha256WithRSA),
    octets(signature),
  ]);

  const signedData = sequence([
    integer(String.fromCharCode(1)),
    set([algorithm(OID.sha256)]),
    sequence([oid(OID.data)]),
    asn1.create(
      Class.CONTEXT_SPECIFIC,
      0,
      true,
      chain.map((cert) => pki.certificateToAsn1(cert)),
    ),
    set([signerInfo]),
  ]);

  const contentInfo = sequence([
    oid(OID.signedData),
    asn1.create(Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);
  return fromBinary(asn1.toDer(contentInfo).getBytes());
}
