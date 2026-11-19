import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** An A4 PDF with `pages` pages of text. */
export async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Offer letter, page ${i + 1}`, { x: 72, y: 760, size: 14, font });
  }
  return doc.save();
}

/** A self-signed RSA seal certificate in a PKCS#12 file, for tests only. */
export function makeP12(commonName: string, passphrase: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const subject = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Codevibe Test' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  return new Uint8Array(Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'));
}
