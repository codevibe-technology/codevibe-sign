import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { seal } from '@codevibe_technology/sign-pdf';
import { AppError } from './errors';
import { inspectUpload } from './pdf';

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawText('Offer letter', { x: 40, y: 40, size: 12 });
  return doc.save();
}

function testP12(passphrase: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const subject = [{ name: 'commonName', value: 'Upload Test Seal' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  return new Uint8Array(Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'));
}

describe('inspectUpload', () => {
  it('accepts an unsigned PDF', async () => {
    expect(await inspectUpload('offer.pdf', await onePagePdf())).toMatchObject({ pageCount: 1 });
  });

  it('shows the already signed message for a PDF that carries signatures', async () => {
    const signed = await seal(await onePagePdf(), { p12: testP12('x'), passphrase: 'x' });
    const error = await inspectUpload('offer.pdf', signed).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'VALIDATION',
      field: 'file',
      message:
        'This PDF already carries digital signatures. Signing it again here would remove them. Upload the unsigned original.',
    });
    // RSA key generation in pure JavaScript is slow on a busy machine.
  }, 30_000);
});
