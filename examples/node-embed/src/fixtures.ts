import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** A one-page offer letter with two lines to sign on. */
export async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText('Offer letter', { x: 72, y: 760, size: 20, font });
  page.drawText('We are glad to offer you the role of Engineer.', {
    x: 72,
    y: 720,
    size: 12,
    font,
  });
  for (const [x, label] of [
    [72, 'Candidate'],
    [320, 'Hiring manager'],
  ] as const) {
    page.drawLine({ start: { x, y: 150 }, end: { x: x + 200, y: 150 }, thickness: 0.5 });
    page.drawText(label, { x, y: 136, size: 9, font });
  }
  return doc.save();
}

/** A self-signed seal certificate as PKCS#12. Fine for trying things out, never for production. */
export function selfSignedSeal(passphrase: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const subject = [{ name: 'commonName', value: 'Codevibe Sign example seal' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  return new Uint8Array(Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
}
