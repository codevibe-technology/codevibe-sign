import { createHash, randomBytes, verify as verifySignature, X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { SignError } from '@codevibe_technology/sign-core';
import { OID, algorithm, integer, octets, parseDerExact, sequence } from './cms';

const { asn1 } = forge;
type Asn1 = forge.asn1.Asn1;

export interface TimestampOptions {
  /** Milliseconds to wait for the timestamp authority. Defaults to 15 seconds. */
  timeoutMs?: number;
}

/** What a timestamp token says, once its structure has been read. */
export interface TimestampInfo {
  /** ISO time the authority vouches for. */
  genTime: string;
  /** Digest algorithm OID of the message imprint. */
  hashAlgorithm: string;
  /** The message imprint, binary. */
  hashedMessage: string;
  /** The nonce, as the DER content of the INTEGER, when present. */
  nonce?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

const HASHES: Record<string, string> = {
  [OID.sha256]: 'sha256',
  [OID.sha384]: 'sha384',
  [OID.sha512]: 'sha512',
};

const RSA_PSS = '1.2.840.113549.1.1.10';

function children(node: Asn1 | undefined): Asn1[] {
  return node && Array.isArray(node.value) ? (node.value as Asn1[]) : [];
}

function oidOf(node: Asn1 | undefined): string | undefined {
  if (!node || node.type !== asn1.Type.OID || typeof node.value !== 'string') return undefined;
  return asn1.derToOid(node.value);
}

const der = (node: Asn1) => asn1.toDer(node).getBytes();
const isContext = (node: Asn1 | undefined, tag: number) =>
  node?.tagClass === asn1.Class.CONTEXT_SPECIFIC && node.type === tag;

/** An INTEGER's content without leading zero bytes, so equal numbers compare equal. */
function integerValue(node: Asn1 | undefined): string | undefined {
  if (!node || node.type !== asn1.Type.INTEGER || typeof node.value !== 'string') return undefined;
  let start = 0;
  while (start < node.value.length && node.value.charCodeAt(start) === 0) start += 1;
  return node.value.slice(start);
}

function failure(message: string, details: Record<string, unknown> = {}): SignError {
  return new SignError('SEAL_FAILED', message, { option: 'tsaUrl', ...details });
}

/** The TSTInfo of a timestamp token (ContentInfo with SignedData), and the SignedData parts. */
function readToken(token: Asn1) {
  const [type, wrapped] = children(token);
  if (oidOf(type) !== OID.signedData) throw failure('The timestamp token is not CMS SignedData.');
  const parts = children(children(wrapped)[0]);
  const encapsulated = parts[2];
  const [contentType, explicitContent] = children(encapsulated);
  if (oidOf(contentType) !== OID.tstInfo) {
    throw failure('The timestamp token does not hold TSTInfo.');
  }
  const content = children(explicitContent)[0];
  if (!content || content.type !== asn1.Type.OCTETSTRING || typeof content.value !== 'string') {
    throw failure('The timestamp token has no TSTInfo content.');
  }
  const tstInfoDer = content.value;
  const tstInfo = parseDerExact(tstInfoDer);
  const [, , imprint, , genTime, ...optional] = children(tstInfo);
  const [hashAlgorithm, hashedMessage] = children(imprint);
  const hashOid = oidOf(children(hashAlgorithm)[0]);
  if (
    !hashOid ||
    hashedMessage?.type !== asn1.Type.OCTETSTRING ||
    typeof hashedMessage.value !== 'string' ||
    genTime?.type !== asn1.Type.GENERALIZEDTIME ||
    typeof genTime.value !== 'string'
  ) {
    throw failure('The timestamp token has a malformed TSTInfo.');
  }
  const nonce = integerValue(
    optional.find(
      (node) => node.tagClass === asn1.Class.UNIVERSAL && node.type === asn1.Type.INTEGER,
    ),
  );
  const info: TimestampInfo = {
    genTime: asn1.generalizedTimeToDate(genTime.value).toISOString(),
    hashAlgorithm: hashOid,
    hashedMessage: hashedMessage.value,
    ...(nonce !== undefined ? { nonce } : {}),
  };
  const certificates = parts.find((part) => isContext(part, 0));
  const signerInfo = children(parts[parts.length - 1])[0];
  return { info, tstInfoDer, certificates: children(certificates), signerInfo };
}

function tbsIssuerAndSerial(certificate: Asn1): [Asn1 | undefined, Asn1 | undefined] {
  const fields = children(children(certificate)[0]);
  const rest = isContext(fields[0], 0) ? fields.slice(1) : fields;
  return [rest[2], rest[0]];
}

/**
 * Checks the authority's signature on the token: the message-digest attribute matches the
 * TSTInfo, and the signature over the signed attributes verifies with the certificate the
 * signer info names. The authority itself is not checked against a trust list here.
 */
function assertTokenSignature(parsed: ReturnType<typeof readToken>): void {
  const [, sid, digestAlgorithm, ...rest] = children(parsed.signerInfo);
  const attributes = rest.find((part) => isContext(part, 0));
  const signatureAlgorithm = rest.find(
    (part) => part.tagClass === asn1.Class.UNIVERSAL && part.type === asn1.Type.SEQUENCE,
  );
  const signature = rest.find(
    (part) => part.tagClass === asn1.Class.UNIVERSAL && part.type === asn1.Type.OCTETSTRING,
  );
  const hash = HASHES[oidOf(children(digestAlgorithm)[0]) ?? ''];
  if (!attributes || !signature || typeof signature.value !== 'string' || !hash) {
    throw failure('The timestamp token has an unsupported or malformed signer.');
  }

  const digest = children(attributes)
    .map((attribute) => children(attribute))
    .find(([type]) => oidOf(type) === OID.messageDigest)?.[1];
  const expected = createHash(hash).update(Buffer.from(parsed.tstInfoDer, 'binary')).digest();
  const actual = children(digest)[0]?.value;
  if (typeof actual !== 'string' || !Buffer.from(actual, 'binary').equals(expected)) {
    throw failure('The timestamp token signature does not cover its TSTInfo.');
  }

  const [sidIssuer, sidSerial] = children(sid);
  const certificate =
    parsed.certificates.find((candidate) => {
      const [issuer, serial] = tbsIssuerAndSerial(candidate);
      return (
        sidIssuer &&
        sidSerial &&
        issuer &&
        serial &&
        der(issuer) === der(sidIssuer) &&
        der(serial) === der(sidSerial)
      );
    }) ?? (parsed.certificates.length === 1 ? parsed.certificates[0] : undefined);
  if (!certificate) {
    throw failure('The timestamp token does not include the authority certificate.');
  }

  const signed = Buffer.from(
    der(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, children(attributes))),
    'binary',
  );
  const key = new X509Certificate(Buffer.from(der(certificate), 'binary')).publicKey;
  const pss = oidOf(children(signatureAlgorithm)[0]) === RSA_PSS;
  const valid = verifySignature(
    hash,
    signed,
    pss ? { key, padding: 6, saltLength: -2 } : key,
    Buffer.from(signature.value, 'binary'),
  );
  if (!valid) throw failure('The timestamp token signature is not valid.');
}

/**
 * Reads a timestamp token's TSTInfo after checking the authority's signature on it. Throws
 * when the token is not one or the signature does not verify.
 */
export function timestampInfo(token: Uint8Array): TimestampInfo {
  const parsed = readToken(parseDerExact(Buffer.from(token).toString('binary')));
  assertTokenSignature(parsed);
  return parsed.info;
}

function timeStampRequest(digest: Buffer, nonce: Buffer): Buffer {
  const request = sequence([
    integer(String.fromCharCode(1)),
    sequence([algorithm(OID.sha256), octets(digest.toString('binary'))]),
    integer(nonce.toString('binary')),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0xff)),
  ]);
  return Buffer.from(der(request), 'binary');
}

/** A positive 64-bit nonce, encoded as the minimal INTEGER content. */
function makeNonce(): Buffer {
  const bytes = randomBytes(8);
  bytes[0] = (bytes[0]! & 0x7f) | 0x01;
  return bytes;
}

async function post(url: string, body: Buffer, timeoutMs: number): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/timestamp-query',
        accept: 'application/timestamp-reply',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw failure(`The timestamp authority at ${url} could not be reached.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    throw failure(`The timestamp authority at ${url} answered HTTP ${response.status}.`, {
      status: response.status,
    });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) {
    throw failure(`The timestamp authority at ${url} sent a response that is too large.`);
  }
  return bytes;
}

/**
 * Asks an RFC 3161 timestamp authority for a token over `data` (SHA-256 message imprint) and
 * checks the answer: status granted, the same nonce and imprint, and a valid authority
 * signature. Returns the token (CMS ContentInfo, DER). Throws `SEAL_FAILED` otherwise.
 */
export async function requestTimestamp(
  url: string,
  data: Uint8Array,
  options: TimestampOptions = {},
): Promise<Uint8Array> {
  if (!/^https?:\/\//i.test(url)) {
    throw failure('tsaUrl must be an http:// or https:// URL.');
  }
  const digest = createHash('sha256').update(data).digest();
  const nonce = makeNonce();
  const reply = await post(
    url,
    timeStampRequest(digest, nonce),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Asn1;
  try {
    response = parseDerExact(reply.toString('binary'));
  } catch {
    throw failure(`The timestamp authority at ${url} sent a response that is not DER.`);
  }
  const [statusInfo, token] = children(response);
  const status = integerValue(children(statusInfo)[0]);
  if (status !== '' && status !== '\x01') {
    const text = children(children(statusInfo)[1])
      .map((node) => (typeof node.value === 'string' ? node.value : ''))
      .join(' ');
    throw failure(
      `The timestamp authority at ${url} refused the request${text ? `: ${text}` : ''}.`,
      {
        status: status?.charCodeAt(0) ?? null,
      },
    );
  }
  if (!token) throw failure(`The timestamp authority at ${url} granted no token.`);

  let parsed: ReturnType<typeof readToken>;
  try {
    parsed = readToken(token);
  } catch (error) {
    if (error instanceof SignError) throw error;
    throw failure('The timestamp token could not be read.');
  }
  if (
    parsed.info.hashAlgorithm !== OID.sha256 ||
    parsed.info.hashedMessage !== digest.toString('binary')
  ) {
    throw failure('The timestamp token is for different data (message imprint mismatch).');
  }
  if (parsed.info.nonce !== nonce.toString('binary')) {
    throw failure('The timestamp token does not carry the nonce that was sent.');
  }
  assertTokenSignature(parsed);
  return new Uint8Array(Buffer.from(der(token), 'binary'));
}
