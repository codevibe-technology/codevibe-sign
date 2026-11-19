import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import forge from 'node-forge';

const out = process.argv[2] ?? 'data/dev-seal.p12';
const passphrase = process.env.SEAL_PASSPHRASE ?? 'dev';

if (existsSync(out)) {
  console.log(`${out} already exists; delete it to make a new one.`);
  process.exit(0);
}

const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = Date.now().toString(16);
cert.validity.notBefore = new Date(Date.now() - 86_400_000);
cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
const subject = [
  { name: 'commonName', value: 'Codevibe Sign development seal' },
  { name: 'organizationName', value: 'Development only' },
];
cert.setSubject(subject);
cert.setIssuer(subject);
cert.sign(keys.privateKey, forge.md.sha256.create());
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), { mode: 0o600 });
console.log(`Wrote ${out}. Set SEAL_P12_PATH=${out} and SEAL_PASSPHRASE=${passphrase}.`);
console.log('This self-signed seal is for development; production needs a real certificate.');
