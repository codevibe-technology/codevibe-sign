import { SignPdf } from '@signpdf/signpdf';
import { Signer } from '@signpdf/utils';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { buildCadesSignature } from '../cms';
import { addSignaturePlaceholder } from '../placeholder';
import { p12Signer } from '../signer';
import type { TestP12 } from './p12';

/**
 * Adds one more approval signature to a file by rewriting it, the way `seal()` refuses to: the
 * signatures already in the file stay in its form but no longer match its bytes. For tests of
 * files with several signatures only.
 */
export async function signAgainForTest(bytes: Uint8Array, identity: TestP12): Promise<Uint8Array> {
  const signer = p12Signer({ p12: identity.p12, passphrase: identity.passphrase });
  const chainDer = (await signer.certificateChain()).map((der) =>
    Buffer.from(der).toString('binary'),
  );
  const chain = chainDer.map((der) => forge.pki.certificateFromAsn1(forge.asn1.fromDer(der)));
  const doc = await PDFDocument.load(bytes);
  addSignaturePlaceholder(doc, {
    kind: 'approval',
    reason: 'Second signature',
    location: '',
    contactInfo: '',
    name: 'Test',
    signingTime: new Date(),
    signatureLength: 8192,
  });
  const prepared = await doc.save({ useObjectStreams: false });
  class TestSigner extends Signer {
    override async sign(content: Buffer): Promise<Buffer> {
      return buildCadesSignature(content, { chain, chainDer, sign: (data) => signer.sign(data) });
    }
  }
  return new Uint8Array(await new SignPdf().sign(Buffer.from(prepared), new TestSigner()));
}
