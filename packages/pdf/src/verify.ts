import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { OID } from './cms';

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
}

const DIGESTS: Record<string, { node: string; forge: () => forge.md.MessageDigest }> = {
  [OID.sha256]: { node: 'sha256', forge: () => forge.md.sha256.create() },
  '2.16.840.1.101.3.4.2.2': { node: 'sha384', forge: () => forge.md.sha384.create() },
  '2.16.840.1.101.3.4.2.3': { node: 'sha512', forge: () => forge.md.sha512.create() },
};

const BYTE_RANGE = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;

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
  signedAttributes: Asn1[];
  signature: string;
  certificates: { node: Asn1; cert: forge.pki.Certificate | null }[];
  sidSerial?: Asn1;
  sidIssuer?: Asn1;
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
  const signatureNode = rest[rest.length - 1];
  const digestOid = oidOf(children(digestAlgorithm)[0]);
  if (!attributesNode || !signatureNode || !digestOid || typeof signatureNode.value !== 'string') {
    return null;
  }

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
    signedAttributes: children(attributesNode),
    signature: signatureNode.value,
    certificates,
    sidIssuer: isIssuerAndSerial ? children(sid)[0] : undefined,
    sidSerial: isIssuerAndSerial ? children(sid)[1] : undefined,
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

function field(cert: forge.pki.Certificate, name: string): string | undefined {
  const entry = cert.subject.getField(name) as { value?: unknown } | null;
  return typeof entry?.value === 'string' ? entry.value : undefined;
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

/** Checks the CMS signature against the signed bytes. Any parse problem means "not valid". */
function checkSignature(
  signedContent: Buffer,
  cmsBinary: string,
): { valid: boolean; signer?: SealSigner; signedAt?: string } {
  let parsed: ParsedSignature | null;
  try {
    parsed = parseCms(cmsBinary);
  } catch {
    return { valid: false };
  }
  if (!parsed) {
    return { valid: false };
  }
  const digest = DIGESTS[parsed.digestOid];
  const signerCert = findSignerCertificate(parsed);
  const cert = signerCert?.cert ?? undefined;
  const signer = cert
    ? { commonName: field(cert, 'CN'), organization: field(cert, 'O') }
    : undefined;
  const signedAt = signingTimeOf(parsed.signedAttributes);
  if (!digest || !signerCert || !cert) {
    return { valid: false, signer, signedAt };
  }

  const messageDigest = attributeValue(parsed.signedAttributes, OID.messageDigest);
  const contentDigest = createHash(digest.node).update(signedContent).digest('binary');
  if (!messageDigest || messageDigest.value !== contentDigest) {
    return { valid: false, signer, signedAt };
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
      ? createHash(hash.node)
          .update(Buffer.from(der(signerCert.node), 'binary'))
          .digest('binary')
      : undefined;
    if (!hashNode || hashNode.value !== expected) {
      return { valid: false, signer, signedAt };
    }
  }

  const attributesDer = der(
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, parsed.signedAttributes),
  );
  const md = digest.forge();
  md.update(attributesDer);
  let verified = false;
  try {
    verified = (cert.publicKey as forge.pki.rsa.PublicKey).verify(
      md.digest().getBytes(),
      parsed.signature,
    );
  } catch {
    verified = false;
  }
  return { valid: verified, signer, signedAt };
}

/**
 * Verifies the first signature in the file: the byte range is well formed, the
 * /Contents hold exactly the CMS structure, its message digest matches the covered
 * bytes and the RSA signature checks out against the embedded signer certificate.
 * Whether that certificate is trusted is left to the caller.
 */
export async function verifySeal(bytes: Uint8Array): Promise<SealVerification> {
  const pdf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = pdf.toString('latin1');
  const matches = [...text.matchAll(BYTE_RANGE)];
  const first = matches[0];
  const notSealed = { sealed: false, valid: false, coversWholeDocument: false, signatureCount: 0 };
  if (!first) {
    return notSealed;
  }

  const [start, firstLength, secondStart, secondLength] = first.slice(1, 5).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const signatureCount = matches.length;
  const coversWholeDocument = secondStart + secondLength === pdf.length;
  const result: SealVerification = {
    sealed: true,
    valid: false,
    coversWholeDocument,
    signatureCount,
  };

  const gapStart = start + firstLength;
  const wellFormed =
    start === 0 &&
    gapStart < secondStart &&
    secondStart + secondLength <= pdf.length &&
    text[gapStart] === '<' &&
    text[secondStart - 1] === '>';
  if (!wellFormed) {
    return result;
  }

  const dictStart = text.lastIndexOf('obj', gapStart);
  const dictEnd = text.indexOf('endobj', secondStart);
  const dictionary = text.slice(
    Math.max(0, dictStart),
    dictEnd === -1 ? secondStart + 4096 : dictEnd,
  );
  const dateMatch = /\/M\s*\((D:[^)]*)\)/.exec(dictionary);
  const dictionaryTime = dateMatch?.[1] ? parsePdfDate(dateMatch[1]) : undefined;

  // The /Contents must be exactly the DER signature in lowercase hex, padded with zeros,
  // so that no byte of the file can change without the check failing.
  const hex = text.slice(gapStart + 1, secondStart - 1);
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) {
    return { ...result, signedAt: dictionaryTime };
  }
  const contents = Buffer.from(hex, 'hex');
  const length = derLength(contents);
  if (length === null || contents.subarray(length).some((byte) => byte !== 0)) {
    return { ...result, signedAt: dictionaryTime };
  }

  const signedContent = Buffer.concat([
    pdf.subarray(start, gapStart),
    pdf.subarray(secondStart, secondStart + secondLength),
  ]);
  const check = checkSignature(signedContent, contents.subarray(0, length).toString('binary'));
  return {
    ...result,
    valid: check.valid,
    signer: check.signer,
    signedAt: check.signedAt ?? dictionaryTime,
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
