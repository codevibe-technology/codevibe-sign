import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';

export interface DevSealOptions {
  /** Certificate common name. Default `Codevibe Sign Development Seal`. */
  commonName?: string;
  organization?: string;
  /** Days the certificate stays valid, from now. Default 365. */
  days?: number;
  /** Protects the PKCS#12 file. A random one is generated when omitted. */
  passphrase?: string;
  /** Start of validity. Default now minus one hour, so clocks a little behind still accept it. */
  notBefore?: Date;
}

export interface DevSeal {
  /** PKCS#12 file with the RSA-2048 key and the self-signed certificate. */
  p12: Uint8Array;
  passphrase: string;
  /** The certificate, PEM: pass it to `verify()` as a trusted certificate. */
  certificatePem: string;
  /** SHA-256 of the certificate (DER), lowercase hex. */
  sha256: string;
  notBefore: Date;
  notAfter: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Creates a self-signed RSA-2048 sealing certificate for development and tests. PDF readers
 * show seals made with it as untrusted; production needs a certificate issued by a CA.
 */
export function createDevSeal(options: DevSealOptions = {}): DevSeal {
  const days = options.days ?? 365;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new RangeError('days must be a whole number from 1 to 3650');
  }
  const passphrase = options.passphrase ?? randomBytes(18).toString('base64url');
  const notBefore = options.notBefore ?? new Date(Date.now() - HOUR_MS);
  const notAfter = new Date(notBefore.getTime() + days * DAY_MS);

  // Node generates the key natively; forge alone takes seconds for RSA-2048.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const key = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey;

  const certificate = forge.pki.createCertificate();
  certificate.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  certificate.serialNumber = `01${randomBytes(15).toString('hex')}`;
  certificate.validity.notBefore = notBefore;
  certificate.validity.notAfter = notAfter;
  const subject: forge.pki.CertificateField[] = [
    { name: 'commonName', value: options.commonName ?? 'Codevibe Sign Development Seal' },
  ];
  if (options.organization) {
    subject.push({ name: 'organizationName', value: options.organization });
  }
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  certificate.sign(key, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(key, [certificate], passphrase, {
    algorithm: 'aes256',
    friendlyName: 'seal',
  });
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  return {
    p12: new Uint8Array(Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary')),
    passphrase,
    certificatePem: forge.pki.certificateToPem(certificate),
    sha256: createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex'),
    notBefore,
    notAfter,
  };
}
