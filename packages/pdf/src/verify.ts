import { constants, createHash, verify as verifyWithKey, X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { OID } from './cms';
import { signatureFields, type SignatureField } from './signatures';
import { timestampInfo } from './tsa';

const { asn1, pki } = forge;
type Asn1 = forge.asn1.Asn1;

export interface SealSigner {
  commonName?: string;
  organization?: string;
}

export interface SealVerification {
  /** The file carries a PDF signature. */
  sealed: boolean;
  /** The signature is intact and matches the bytes it covers. Trust in the certificate is not checked. */
  valid: boolean;
  /** The signature covers every byte of the file (nothing was appended after sealing). */
  coversWholeDocument: boolean;
  signer?: SealSigner;
  /** ISO time from the signature (signing-time attribute, else the signature dictionary). */
  signedAt?: string;
  /** Number of signatures found in the file. The first one is the one verified. */
  signatureCount: number;
  /**
   * ISO time from the RFC 3161 signature timestamp (PAdES B-T), when the seal carries one whose
   * message imprint matches the signature. Whether the timestamp authority is trusted is not
   * checked.
   */
  timestampedAt?: string;
}

/** One signature of a file that may carry several; see `verifySignatures`. */
export interface SignatureInfo {
  /**
   * The signature is intact: it matches the bytes it covers and, when it is not the first,
   * covers the signatures before it. Trust in the certificate is not checked.
   */
  valid: boolean;
  /** The signature covers every byte of the file. */
  coversWholeDocument: boolean;
  /** Where the covered bytes end: the length of the file when this signature was made. */
  coveredBytes: number;
  /** Subject of the certificate that made the signature. */
  signer?: SealSigner;
  /** Who issued that certificate, for example the eSign provider's certifying authority. */
  issuer?: SealSigner;
  /** ISO time from the signature (signing-time attribute, else the signature dictionary). */
  signedAt?: string;
  /** SHA-256 of the signer certificate (DER), lowercase hex. */
  certificateSha256?: string;
  /** The signature format, for example `ETSI.CAdES.detached` or `adbe.pkcs7.detached`. */
  subFilter?: string;
  /** ISO time of a signature timestamp whose imprint matches the signature. */
  timestampedAt?: string;
}

const SIGNATURE_OID = {
  rsaPss: '1.2.840.113549.1.1.10',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
} as const;

const DIGESTS: Record<string, { node: string; forge: () => forge.md.MessageDigest }> = {
  [OID.sha256]: { node: 'sha256', forge: () => forge.md.sha256.create() },
  '2.16.840.1.101.3.4.2.2': { node: 'sha384', forge: () => forge.md.sha384.create() },
  '2.16.840.1.101.3.4.2.3': { node: 'sha512', forge: () => forge.md.sha512.create() },
};

function children(node: Asn1 | undefined): Asn1[] {
  return node && Array.isArray(node.value) ? (node.value as Asn1[]) : [];
}

function oidOf(node: Asn1 | undefined): string | undefined {
  if (!node || node.type !== asn1.Type.OID || typeof node.value !== 'string') {
    return undefined;
  }
  return asn1.derToOid(node.value);
}

function der(node: Asn1): string {
  return asn1.toDer(node).getBytes();
}

/** Parses "D:YYYYMMDDHHmmSS+HH'mm'" (any trailing part optional) into an ISO string. */
export function parsePdfDate(value: string): string | undefined {
  const match =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz+-])(?:(\d{2})'?(\d{2})?'?)?)?/.exec(
      value,
    );
  if (!match) {
    return undefined;
  }
  const [
    ,
    year,
    month = '01',
    day = '01',
    hour = '00',
    minute = '00',
    second = '00',
    sign,
    tzHour = '00',
    tzMinute = '00',
  ] = match;
  const offset = !sign || sign === 'Z' || sign === 'z' ? 'Z' : `${sign}${tzHour}:${tzMinute}`;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

interface ParsedSignature {
  digestOid: string;
  /** Null when the signer signed the content itself, without signed attributes. */
  signedAttributes: Asn1[] | null;
  signatureAlgorithm?: Asn1;
  signature: string;
  certificates: { node: Asn1; cert: forge.pki.Certificate | null }[];
  sidSerial?: Asn1;
  sidIssuer?: Asn1;
  unsignedAttributes: Asn1[];
}

/** forge accepts an options object here, though its type definitions only declare a boolean. */
const strictFromDer = asn1.fromDer as unknown as (
  bytes: string,
  options: { strict: boolean; parseAllBytes: boolean },
) => Asn1;

function parseCms(binary: string): ParsedSignature | null {
  const contentInfo = strictFromDer(binary, { strict: true, parseAllBytes: true });
  const [type, wrapped] = children(contentInfo);
  if (oidOf(type) !== OID.signedData) {
    return null;
  }
  const signedData = children(wrapped)[0];
  const parts = children(signedData);
  const signerInfos = parts[parts.length - 1];
  const certificateSet = parts.find(
    (part) => part.tagClass === asn1.Class.CONTEXT_SPECIFIC && part.type === 0,
  );
  const signerInfo = children(signerInfos)[0];
  if (!signerInfo) {
    return null;
  }
  const [, sid, digestAlgorithm, ...rest] = children(signerInfo);
  const attributesNode = rest.find(
    (part) => part.tagClass === asn1.Class.CONTEXT_SPECIFIC && part.type === 0,
  );
  const signatureNode = rest.find(
    (part) => part.tagClass === asn1.Class.UNIVERSAL && part.type === asn1.Type.OCTETSTRING,
  );
  const unsignedNode = rest.find(
    (part) => part.tagClass === asn1.Class.CONTEXT_SPECIFIC && part.type === 1,
  );
  const digestOid = oidOf(children(digestAlgorithm)[0]);
  if (!signatureNode || !digestOid || typeof signatureNode.value !== 'string') {
    return null;
  }
  const signatureAlgorithm = rest[rest.indexOf(signatureNode) - 1];

  const certificates = children(certificateSet).map((node) => {
    try {
      return { node, cert: pki.certificateFromAsn1(node) };
    } catch {
      return { node, cert: null };
    }
  });
  const isIssuerAndSerial =
    sid?.tagClass === asn1.Class.UNIVERSAL && sid.type === asn1.Type.SEQUENCE;
  return {
    digestOid,
    signedAttributes: attributesNode ? children(attributesNode) : null,
    ...(signatureAlgorithm && signatureAlgorithm !== attributesNode ? { signatureAlgorithm } : {}),
    signature: signatureNode.value,
    certificates,
    sidIssuer: isIssuerAndSerial ? children(sid)[0] : undefined,
    sidSerial: isIssuerAndSerial ? children(sid)[1] : undefined,
    unsignedAttributes: children(unsignedNode),
  };
}

function attributeValue(attributes: Asn1[], type: string): Asn1 | undefined {
  for (const attribute of attributes) {
    const [typeNode, values] = children(attribute);
    if (oidOf(typeNode) === type) {
      return children(values)[0];
    }
  }
  return undefined;
}

function tbsFields(node: Asn1): Asn1[] {
  const fields = children(children(node)[0]);
  const hasVersion = fields[0]?.tagClass === asn1.Class.CONTEXT_SPECIFIC && fields[0]?.type === 0;
  return hasVersion ? fields.slice(1) : fields;
}

function findSignerCertificate(
  parsed: ParsedSignature,
): ParsedSignature['certificates'][number] | undefined {
  const { sidIssuer, sidSerial } = parsed;
  if (sidIssuer && sidSerial) {
    const match = parsed.certificates.find(({ node }) => {
      const [serial, , issuer] = tbsFields(node);
      return serial && issuer && der(serial) === der(sidSerial) && der(issuer) === der(sidIssuer);
    });
    if (match) {
      return match;
    }
  }
  return parsed.certificates.length === 1 ? parsed.certificates[0] : undefined;
}

/** Common name and organisation of a certificate's subject (field 4) or issuer (field 2). */
function nameOf(certificate: Asn1, position: 2 | 4): SealSigner | undefined {
  const result: SealSigner = {};
  for (const rdn of children(tbsFields(certificate)[position])) {
    for (const pair of children(rdn)) {
      const [typeNode, valueNode] = children(pair);
      const type = oidOf(typeNode);
      if (!valueNode || typeof valueNode.value !== 'string') {
        continue;
      }
      let value = valueNode.value;
      if (valueNode.type === asn1.Type.UTF8) {
        try {
          value = forge.util.decodeUtf8(value);
        } catch {
          continue;
        }
      } else if (valueNode.type === asn1.Type.BMPSTRING) {
        value = Buffer.from(value, 'binary').swap16().toString('utf16le');
      }
      if (type === SIGNATURE_OID.commonName) {
        result.commonName = value;
      } else if (type === SIGNATURE_OID.organization) {
        result.organization = value;
      }
    }
  }
  return result.commonName || result.organization ? result : undefined;
}

function signingTimeOf(attributes: Asn1[]): string | undefined {
  const node = attributeValue(attributes, OID.signingTime);
  if (!node || typeof node.value !== 'string') {
    return undefined;
  }
  const date =
    node.type === asn1.Type.UTCTIME
      ? asn1.utcTimeToDate(node.value)
      : asn1.generalizedTimeToDate(node.value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The time of a signature timestamp whose imprint is the digest of the signature value. */
function timestampOf(parsed: ParsedSignature): string | undefined {
  const token = attributeValue(parsed.unsignedAttributes, OID.signatureTimeStampToken);
  if (!token) {
    return undefined;
  }
  try {
    const info = timestampInfo(new Uint8Array(Buffer.from(der(token), 'binary')));
    const digest = DIGESTS[info.hashAlgorithm];
    const imprint = digest
      ? createHash(digest.node).update(Buffer.from(parsed.signature, 'binary')).digest('binary')
      : undefined;
    return imprint === info.hashedMessage ? info.genTime : undefined;
  } catch {
    return undefined;
  }
}

/** The salt length of an RSASSA-PSS signature, from its parameters; 20 when left out. */
function pssSaltLength(algorithm: Asn1 | undefined): number {
  const salt = children(children(algorithm)[1]).find(
    (part) => part.tagClass === asn1.Class.CONTEXT_SPECIFIC && part.type === 2,
  );
  const value = children(salt)[0]?.value;
  return typeof value === 'string' && value.length > 0 && value.length <= 2
    ? Buffer.from(value, 'binary').readUIntBE(0, value.length)
    : 20;
}

/**
 * Checks the signature value with the certificate's public key: RSA (PKCS#1 v1.5 or PSS) or
 * ECDSA, whichever the certificate holds.
 */
function publicKeyVerifies(
  certificateDer: string,
  parsed: ParsedSignature,
  digest: string,
  data: Buffer,
): boolean {
  try {
    const key = new X509Certificate(Buffer.from(certificateDer, 'binary')).publicKey;
    const signature = Buffer.from(parsed.signature, 'binary');
    const type = key.asymmetricKeyType;
    if (type === 'ec') {
      return verifyWithKey(digest, data, key, signature);
    }
    if (type !== 'rsa' && type !== 'rsa-pss') {
      return false;
    }
    const pss =
      type === 'rsa-pss' || oidOf(children(parsed.signatureAlgorithm)[0]) === SIGNATURE_OID.rsaPss;
    return pss
      ? verifyWithKey(
          digest,
          data,
          {
            key,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: pssSaltLength(parsed.signatureAlgorithm),
          },
          signature,
        )
      : verifyWithKey(digest, data, key, signature);
  } catch {
    return false;
  }
}

interface SignatureCheck {
  valid: boolean;
  timestampedAt?: string;
  signer?: SealSigner;
  issuer?: SealSigner;
  signedAt?: string;
  signerCertificateDer?: string;
  certificates: forge.pki.Certificate[];
}

/** Checks the CMS signature against the signed bytes. Any parse problem means "not valid". */
function checkSignature(signedContent: Buffer, cmsBinary: string): SignatureCheck {
  let parsed: ParsedSignature | null;
  try {
    parsed = parseCms(cmsBinary);
  } catch {
    return { valid: false, certificates: [] };
  }
  if (!parsed) {
    return { valid: false, certificates: [] };
  }
  const digest = DIGESTS[parsed.digestOid];
  const signerCert = findSignerCertificate(parsed);
  const certificates = parsed.certificates
    .map((entry) => entry.cert)
    .filter((entry): entry is forge.pki.Certificate => entry !== null);
  const signer = signerCert ? nameOf(signerCert.node, 4) : undefined;
  const issuer = signerCert ? nameOf(signerCert.node, 2) : undefined;
  const signedAt = parsed.signedAttributes ? signingTimeOf(parsed.signedAttributes) : undefined;
  const signerCertificateDer = signerCert ? der(signerCert.node) : undefined;
  const invalid: SignatureCheck = {
    valid: false,
    certificates,
    ...(signer ? { signer } : {}),
    ...(issuer ? { issuer } : {}),
    ...(signedAt ? { signedAt } : {}),
    ...(signerCertificateDer ? { signerCertificateDer } : {}),
  };
  if (!digest || !signerCert || !signerCertificateDer) {
    return invalid;
  }

  let signedBytes = signedContent;
  if (parsed.signedAttributes) {
    const messageDigest = attributeValue(parsed.signedAttributes, OID.messageDigest);
    const contentDigest = createHash(digest.node).update(signedContent).digest('binary');
    if (!messageDigest || messageDigest.value !== contentDigest) {
      return invalid;
    }

    const essCertificate = attributeValue(parsed.signedAttributes, OID.signingCertificateV2);
    if (essCertificate) {
      const essCertId = children(children(essCertificate)[0])[0];
      const essParts = children(essCertId);
      const hashAlgorithm =
        essParts[0]?.type === asn1.Type.SEQUENCE ? oidOf(children(essParts[0])[0]) : OID.sha256;
      const hashNode = essParts.find((part) => part.type === asn1.Type.OCTETSTRING);
      const hash = hashAlgorithm ? DIGESTS[hashAlgorithm] : undefined;
      const expected = hash
        ? createHash(hash.node).update(Buffer.from(signerCertificateDer, 'binary')).digest('binary')
        : undefined;
      if (!hashNode || hashNode.value !== expected) {
        return invalid;
      }
    }
    signedBytes = Buffer.from(
      der(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, parsed.signedAttributes)),
      'binary',
    );
  }

  const verified = publicKeyVerifies(signerCertificateDer, parsed, digest.node, signedBytes);
  const timestampedAt = verified ? timestampOf(parsed) : undefined;
  return { ...invalid, valid: verified, ...(timestampedAt ? { timestampedAt } : {}) };
}

/** What examining one signature learns, beyond the public result. */
export interface SealExamination {
  result: SealVerification;
  /** DER (binary string) of the certificate that made the signature, when it was found. */
  signerCertificateDer?: string;
  /** Every certificate embedded in the signature that could be read, signer included. */
  certificates: forge.pki.Certificate[];
  issuer?: SealSigner;
  subFilter?: string;
  /** Where the bytes the signature covers end. */
  coveredBytes: number;
  /** Where the gap that holds the signature value starts. */
  gapStart: number;
}

/**
 * Verifies the first signed signature field of the document's form: the byte range is
 * well formed and is the one the field declares, the /Contents hold exactly the CMS
 * structure, its message digest matches the covered bytes and the signature checks out
 * against the embedded signer certificate. Whether that certificate is trusted is left to
 * the caller; `verify()` adds that check.
 *
 * In a file with several signatures this is the first one in the form, which usually covers
 * only the part of the file that existed when it was made. Use `verifySignatures` to see
 * every signature of such a file.
 */
export async function verifySeal(bytes: Uint8Array): Promise<SealVerification> {
  return (await examineSeal(bytes)).result;
}

const asBuffer = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export async function examineSeal(bytes: Uint8Array): Promise<SealExamination> {
  const fields = await signatureFields(bytes);
  const first = fields[0];
  if (!first) {
    return {
      result: { sealed: false, valid: false, coversWholeDocument: false, signatureCount: 0 },
      certificates: [],
      coveredBytes: 0,
      gapStart: 0,
    };
  }
  return examineField(asBuffer(bytes), first, fields.length, true);
}

/**
 * Every signature of the file, examined on its own and ordered from the earliest revision to
 * the latest. A signature whose gap falls inside the bytes an earlier one covers, or that
 * covers no more than an earlier one, is reported as not valid: a later signature has to
 * cover the earlier ones whole.
 *
 * With `strictLast` the latest signature must hold its value in lowercase hex, as `seal()`
 * and `countersign()` write it, so that not even the case of a digit can change unnoticed.
 * Earlier signatures may use either case: the latest one covers their bytes.
 */
export async function examineSignatures(
  bytes: Uint8Array,
  options: { strictLast?: boolean } = {},
): Promise<SealExamination[]> {
  const pdf = asBuffer(bytes);
  const fields = (await signatureFields(bytes)).sort(
    (a, b) => a.byteRange[2] + a.byteRange[3] - (b.byteRange[2] + b.byteRange[3]),
  );
  const examined = fields.map((entry, index) =>
    examineField(
      pdf,
      entry,
      fields.length,
      options.strictLast === true && index === fields.length - 1,
    ),
  );
  let previousEnd = 0;
  return examined.map((entry) => {
    const coversEarlier = entry.gapStart >= previousEnd && entry.coveredBytes > previousEnd;
    previousEnd = Math.max(previousEnd, entry.coveredBytes);
    return coversEarlier ? entry : { ...entry, result: { ...entry.result, valid: false } };
  });
}

/** The public description of one examined signature. */
export function signatureInfo(examination: SealExamination): SignatureInfo {
  const { result, signerCertificateDer, issuer, subFilter } = examination;
  return {
    valid: result.valid,
    coversWholeDocument: result.coversWholeDocument,
    coveredBytes: examination.coveredBytes,
    ...(result.signer ? { signer: result.signer } : {}),
    ...(issuer ? { issuer } : {}),
    ...(result.signedAt ? { signedAt: result.signedAt } : {}),
    ...(signerCertificateDer
      ? {
          certificateSha256: createHash('sha256')
            .update(Buffer.from(signerCertificateDer, 'binary'))
            .digest('hex'),
        }
      : {}),
    ...(subFilter ? { subFilter } : {}),
    ...(result.timestampedAt ? { timestampedAt: result.timestampedAt } : {}),
  };
}

/**
 * Lists every signature of a PDF from the earliest to the latest, each checked against the
 * bytes it covers: the seal, and any signature the file carried before it, such as an Aadhaar
 * eSign applied by an eSign provider. It reads CMS signatures in `ETSI.CAdES.detached` and
 * `adbe.pkcs7.detached` form made with RSA (PKCS#1 v1.5 or PSS) or ECDSA keys and SHA-256,
 * SHA-384 or SHA-512. Whether a certificate is trusted is not checked; `verify()` does that
 * for the seal.
 */
export async function verifySignatures(bytes: Uint8Array): Promise<SignatureInfo[]> {
  return (await examineSignatures(bytes)).map(signatureInfo);
}

function examineField(
  pdf: Buffer,
  first: SignatureField,
  signatureCount: number,
  strictHex: boolean,
): SealExamination {
  const [start, firstLength, secondStart, secondLength] = first.byteRange;
  const coveredBytes = secondStart + secondLength;
  const coversWholeDocument = coveredBytes === pdf.length;
  const dictionaryTime = first.signingDate ? parsePdfDate(first.signingDate) : undefined;
  const result: SealVerification = {
    sealed: true,
    valid: false,
    coversWholeDocument,
    signatureCount,
    ...(dictionaryTime ? { signedAt: dictionaryTime } : {}),
  };

  const gapStart = start + firstLength;
  const unread: SealExamination = {
    result,
    certificates: [],
    coveredBytes,
    gapStart,
    ...(first.subFilter ? { subFilter: first.subFilter } : {}),
  };
  const wellFormed =
    start === 0 &&
    gapStart < secondStart &&
    coveredBytes <= pdf.length &&
    pdf[gapStart] === 0x3c &&
    pdf[secondStart - 1] === 0x3e;
  if (!wellFormed) {
    return unread;
  }

  // The /Contents must be exactly the DER signature in hex (lowercase for a seal), padded
  // with zeros, so that no byte of the file can change without the check failing. It must also be the value the
  // signature field declares, so the byte range cannot point at another one.
  const hex = pdf.toString('latin1', gapStart + 1, secondStart - 1);
  const hexDigits = strictHex ? /^[0-9a-f]*$/ : /^[0-9a-fA-F]*$/;
  if (!hexDigits.test(hex) || hex.length % 2 !== 0 || hex !== first.contentsHex) {
    return unread;
  }
  const contents = Buffer.from(hex, 'hex');
  const length = derLength(contents);
  if (length === null || contents.subarray(length).some((byte) => byte !== 0)) {
    return unread;
  }

  const signedContent = Buffer.concat([
    pdf.subarray(start, gapStart),
    pdf.subarray(secondStart, coveredBytes),
  ]);
  const check = checkSignature(signedContent, contents.subarray(0, length).toString('binary'));
  const signedAt = check.signedAt ?? dictionaryTime;
  return {
    ...unread,
    result: {
      ...result,
      valid: check.valid,
      ...(check.signer ? { signer: check.signer } : {}),
      ...(signedAt ? { signedAt } : {}),
      ...(check.timestampedAt ? { timestampedAt: check.timestampedAt } : {}),
    },
    ...(check.signerCertificateDer ? { signerCertificateDer: check.signerCertificateDer } : {}),
    ...(check.issuer ? { issuer: check.issuer } : {}),
    certificates: check.certificates,
  };
}

/** Total length of the DER element at the start of the buffer, or null if it is not one. */
function derLength(buffer: Buffer): number | null {
  if (buffer.length < 2 || buffer[0] !== 0x30) {
    return null;
  }
  const first = buffer[1] ?? 0;
  if ((first & 0x80) === 0) {
    return 2 + first <= buffer.length ? 2 + first : null;
  }
  const octets = first & 0x7f;
  if (octets === 0 || octets > 4 || buffer.length < 2 + octets) {
    return null;
  }
  let length = 0;
  for (let index = 0; index < octets; index += 1) {
    length = length * 256 + (buffer[2 + index] ?? 0);
  }
  const total = 2 + octets + length;
  return total <= buffer.length ? total : null;
}
