import forge from 'node-forge';

export interface TestP12Options {
  commonName?: string;
  organization?: string;
  passphrase?: string;
  notBefore?: Date;
  notAfter?: Date;
  /** Also put an unrelated CA certificate in the file, ahead of the signing one. */
  withExtraCertificate?: boolean;
}

export interface TestP12 {
  p12: Uint8Array;
  passphrase: string;
  certificatePem: string;
}

function selfSigned(
  keys: forge.pki.rsa.KeyPair,
  commonName: string,
  organization: string,
  notBefore: Date,
  notAfter: Date,
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const subject = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: organization },
    { name: 'countryName', value: 'IN' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return cert;
}

/** Self-signed RSA certificate and key in a PKCS#12 file, for tests only. */
export function createTestP12(options: TestP12Options = {}): TestP12 {
  const passphrase = options.passphrase ?? 'test-passphrase';
  const notBefore = options.notBefore ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const notAfter = options.notAfter ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = selfSigned(
    keys,
    options.commonName ?? 'Codevibe Sign Test Seal',
    options.organization ?? 'Codevibe Test',
    notBefore,
    notAfter,
  );
  const chain = [cert];
  if (options.withExtraCertificate) {
    const otherKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    chain.unshift(selfSigned(otherKeys, 'Unrelated Test CA', 'Codevibe Test', notBefore, notAfter));
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
