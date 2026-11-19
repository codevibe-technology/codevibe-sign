import forge from 'node-forge';

export interface TestCa {
  certificate: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  certificatePem: string;
}

export interface TestP12Options {
  commonName?: string;
  organization?: string;
  passphrase?: string;
  notBefore?: Date;
  notAfter?: Date;
  /** Also put an unrelated CA certificate in the file, ahead of the signing one. */
  withExtraCertificate?: boolean;
  /** RSA key size. Defaults to 2048. */
  bits?: number;
  /** Digest the certificate is signed with. Defaults to SHA-256. */
  certificateDigest?: 'sha1' | 'sha256';
  /** Issue the certificate from this CA (and include the CA in the file) instead of self-signing. */
  issuer?: TestCa;
}

export interface TestP12 {
  p12: Uint8Array;
  passphrase: string;
  certificatePem: string;
}

interface CertificateSpec {
  publicKey: forge.pki.rsa.PublicKey;
  signingKey: forge.pki.rsa.PrivateKey;
  commonName: string;
  organization: string;
  issuer?: forge.pki.Certificate;
  ca?: boolean;
  notBefore: Date;
  notAfter: Date;
  digest?: 'sha1' | 'sha256';
}

function makeCertificate(spec: CertificateSpec): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = spec.publicKey;
  cert.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
  cert.validity.notBefore = spec.notBefore;
  cert.validity.notAfter = spec.notAfter;
  const subject = [
    { name: 'commonName', value: spec.commonName },
    { name: 'organizationName', value: spec.organization },
    { name: 'countryName', value: 'IN' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(spec.issuer ? spec.issuer.subject.attributes : subject);
  cert.setExtensions(
    spec.ca
      ? [
          { name: 'basicConstraints', cA: true },
          { name: 'keyUsage', keyCertSign: true, cRLSign: true },
        ]
      : [
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
        ],
  );
  cert.sign(
    spec.signingKey,
    spec.digest === 'sha1' ? forge.md.sha1.create() : forge.md.sha256.create(),
  );
  return cert;
}

const DAY = 24 * 60 * 60 * 1000;

/** A self-signed root CA, for tests only. */
export function createTestCa(commonName = 'Codevibe Test Root'): TestCa {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = makeCertificate({
    publicKey: keys.publicKey,
    signingKey: keys.privateKey,
    commonName,
    organization: 'Codevibe Test',
    ca: true,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 3650 * DAY),
  });
  return {
    certificate,
    key: keys.privateKey,
    certificatePem: forge.pki.certificateToPem(certificate),
  };
}

/** RSA key and certificate (self-signed, or issued by a test CA) in a PKCS#12 file, for tests only. */
export function createTestP12(options: TestP12Options = {}): TestP12 {
  const passphrase = options.passphrase ?? 'test-passphrase';
  const notBefore = options.notBefore ?? new Date(Date.now() - DAY);
  const notAfter = options.notAfter ?? new Date(Date.now() + 365 * DAY);
  const keys = forge.pki.rsa.generateKeyPair({ bits: options.bits ?? 2048, e: 0x10001 });
  const cert = makeCertificate({
    publicKey: keys.publicKey,
    signingKey: options.issuer?.key ?? keys.privateKey,
    ...(options.issuer ? { issuer: options.issuer.certificate } : {}),
    commonName: options.commonName ?? 'Codevibe Sign Test Seal',
    organization: options.organization ?? 'Codevibe Test',
    notBefore,
    notAfter,
    ...(options.certificateDigest ? { digest: options.certificateDigest } : {}),
  });
  const chain = [cert];
  if (options.issuer) {
    chain.push(options.issuer.certificate);
  }
  if (options.withExtraCertificate) {
    const otherKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    chain.unshift(
      makeCertificate({
        publicKey: otherKeys.publicKey,
        signingKey: otherKeys.privateKey,
        commonName: 'Unrelated Test CA',
        organization: 'Codevibe Test',
        notBefore,
        notAfter,
      }),
    );
  }
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, chain, passphrase, {
    algorithm: '3des',
    friendlyName: 'seal',
  });
  const der = forge.asn1.toDer(asn1).getBytes();
  return {
    p12: new Uint8Array(Buffer.from(der, 'binary')),
    passphrase,
    certificatePem: forge.pki.certificateToPem(cert),
  };
}
