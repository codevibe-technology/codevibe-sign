import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import forge from 'node-forge';
import {
  OID,
  algorithm,
  attribute,
  certificateDer,
  derSorted,
  integer,
  issuerName,
  octets,
  oid,
  sequence,
  serialNumber,
  set,
  sha256Binary,
  signingCertificateV2,
} from '../cms';

const { asn1 } = forge;
type Asn1 = forge.asn1.Asn1;

/** How the fake authority answers. Everything but `ok` is a failure the client must catch. */
export type FakeTsaMode =
  | 'ok'
  | 'rejected'
  | 'wrong-nonce'
  | 'wrong-imprint'
  | 'bad-signature'
  | 'http-error'
  | 'garbage';

export interface FakeTsa {
  url: string;
  /** The authority certificate, PEM. */
  certificatePem: string;
  /** Time the authority puts in its tokens. */
  genTime: Date;
  /** Number of requests answered. */
  readonly requests: number;
  mode: FakeTsaMode;
  close(): Promise<void>;
}

const DAY = 24 * 60 * 60 * 1000;

function makeAuthority() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = `02${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
  certificate.validity.notBefore = new Date(Date.now() - DAY);
  certificate.validity.notAfter = new Date(Date.now() + 3650 * DAY);
  const subject = [
    { name: 'commonName', value: 'Codevibe Test TSA' },
    { name: 'organizationName', value: 'Codevibe Test' },
  ];
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', critical: true, timeStamping: true },
  ]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return { certificate, key: keys.privateKey };
}

const children = (node: Asn1 | undefined): Asn1[] =>
  node && Array.isArray(node.value) ? (node.value as Asn1[]) : [];

function flip(binary: string): string {
  const last = binary.charCodeAt(binary.length - 1);
  return binary.slice(0, -1) + String.fromCharCode(last ^ 0x01);
}

function respond(
  request: string,
  mode: FakeTsaMode,
  authority: ReturnType<typeof makeAuthority>,
  genTime: Date,
): string {
  const [, imprint, ...rest] = children(asn1.fromDer(request));
  const nonce = rest.find((node) => node.type === asn1.Type.INTEGER);
  if (mode === 'rejected') {
    const status = sequence([
      integer(String.fromCharCode(2)),
      sequence([asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTF8, false, 'policy not accepted')]),
    ]);
    return asn1.toDer(sequence([status])).getBytes();
  }

  const [hashAlgorithm, hashed] = children(imprint);
  const messageImprint =
    mode === 'wrong-imprint'
      ? sequence([hashAlgorithm!, octets(flip(String(hashed!.value)))])
      : imprint!;
  const nonceValue = String(nonce?.value ?? '\x01');
  const tstInfo = sequence([
    integer(String.fromCharCode(1)),
    oid('1.3.6.1.4.1.32473.1.1'),
    messageImprint,
    integer(forge.random.getBytesSync(8).replace(/^[\x80-\xff]/, '\x01')),
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.GENERALIZEDTIME,
      false,
      asn1.dateToGeneralizedTime(genTime),
    ),
    integer(mode === 'wrong-nonce' ? flip(nonceValue) : nonceValue),
  ]);
  const tstDer = asn1.toDer(tstInfo).getBytes();

  const signedAttributes = derSorted([
    attribute(OID.contentType, oid(OID.tstInfo)),
    attribute(OID.messageDigest, octets(sha256Binary(tstDer))),
    attribute(OID.signingCertificateV2, signingCertificateV2(authority.certificate)),
  ]);
  const md = forge.md.sha256.create();
  md.update(asn1.toDer(set(signedAttributes)).getBytes());
  const signature = authority.key.sign(md);

  const signerInfo = sequence([
    integer(String.fromCharCode(1)),
    sequence([issuerName(authority.certificate), serialNumber(authority.certificate)]),
    algorithm(OID.sha256),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, signedAttributes),
    algorithm(OID.sha256WithRSA),
    octets(mode === 'bad-signature' ? flip(signature) : signature),
  ]);
  const signedData = sequence([
    integer(String.fromCharCode(3)),
    set([algorithm(OID.sha256)]),
    sequence([
      oid(OID.tstInfo),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [octets(tstDer)]),
    ]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.fromDer(certificateDer(authority.certificate)),
    ]),
    set([signerInfo]),
  ]);
  const token = sequence([
    oid(OID.signedData),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);
  return asn1.toDer(sequence([sequence([integer('\x00')]), token])).getBytes();
}

/**
 * A local RFC 3161 timestamp authority for tests: answers timestamp queries on 127.0.0.1 with
 * tokens signed by a throwaway self-signed TSA certificate.
 */
export async function startFakeTsa(mode: FakeTsaMode = 'ok'): Promise<FakeTsa> {
  const authority = makeAuthority();
  const genTime = new Date(Math.floor(Date.now() / 1000) * 1000);
  let requests = 0;
  const state = { mode };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests += 1;
      if (state.mode === 'http-error') {
        res.writeHead(500).end('busy');
        return;
      }
      if (state.mode === 'garbage') {
        res.writeHead(200, { 'content-type': 'application/timestamp-reply' }).end('not der');
        return;
      }
      const body = Buffer.concat(chunks).toString('binary');
      const reply = respond(body, state.mode, authority, genTime);
      res
        .writeHead(200, { 'content-type': 'application/timestamp-reply' })
        .end(Buffer.from(reply, 'binary'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/tsa`,
    certificatePem: forge.pki.certificateToPem(authority.certificate),
    genTime,
    get requests() {
      return requests;
    },
    get mode() {
      return state.mode;
    },
    set mode(value: FakeTsaMode) {
      state.mode = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
