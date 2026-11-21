import forge from 'node-forge';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { SignError } from '@codevibe_technology/sign-core';
import { signatureKind } from './placeholder';
import { seal } from './seal';
import { cscSigner, p12Signer, pkcs11Signer, type SealProvider } from './signer';
import { A4, makePdf } from './testing/fixtures';
import { createTestCa, createTestP12, type TestCa, type TestP12 } from './testing/p12';
import { verify } from './trust';
import { verifySeal } from './verify';

let pdf: Uint8Array;
let identity: TestP12;
let root: TestCa;

beforeAll(async () => {
  pdf = await makePdf([{ size: A4 }, { size: A4 }]);
  identity = createTestP12({ profile: 'seal-leaf' });
  root = createTestCa();
});

async function rejection(promise: Promise<unknown>): Promise<SignError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignError);
  return error as SignError;
}

const name = (value: string) => PDFName.of(value);

async function signatureDictionaries(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.catalog.lookup(name('AcroForm'), PDFDict);
  const field = form.lookup(name('Fields'), PDFArray).lookup(0, PDFDict);
  const valueRef = field.get(name('V')) as PDFRef;
  return { doc, signature: doc.context.lookup(valueRef, PDFDict), valueRef };
}

/** Certificates embedded in the seal's CMS, leaf first. */
function embeddedCertificates(bytes: Uint8Array): forge.pki.Certificate[] {
  const text = Buffer.from(bytes).toString('latin1');
  const [, start, length] = /\/ByteRange \[(\d+) (\d+)/.exec(text)!.map(Number);
  const hex = text.slice(start! + length! + 1, text.indexOf('>', start! + length!));
  const message = forge.pkcs7.messageFromAsn1(
    forge.asn1.fromDer(Buffer.from(hex.replace(/(00)+$/, ''), 'hex').toString('binary'), false),
  ) as unknown as { certificates: forge.pki.Certificate[] };
  return message.certificates;
}

describe('certification signature (DocMDP)', () => {
  it('certifies the file with DocMDP P=1 when the seal is the first signature', async () => {
    const sealed = await seal(pdf, { p12: identity.p12, passphrase: identity.passphrase });
    const { doc, signature, valueRef } = await signatureDictionaries(sealed);
    const perms = doc.catalog.lookup(name('Perms'), PDFDict);
    expect(perms.get(name('DocMDP'))).toBe(valueRef);

    const reference = signature.lookup(name('Reference'), PDFArray).lookup(0, PDFDict);
    expect(reference.get(name('Type'))).toBe(name('SigRef'));
    expect(reference.get(name('TransformMethod'))).toBe(name('DocMDP'));
    const params = reference.lookup(name('TransformParams'), PDFDict);
    expect(params.get(name('Type'))).toBe(name('TransformParams'));
    expect(params.lookup(name('P'), PDFNumber).asNumber()).toBe(1);
    expect(params.get(name('V'))).toBe(name('1.2'));
    expect(signature.get(name('SubFilter'))).toBe(name('ETSI.CAdES.detached'));
    expect((await verifySeal(sealed)).valid).toBe(true);
  });

  it('makes an approval signature when certification is turned off', async () => {
    const sealed = await seal(pdf, {
      p12: identity.p12,
      passphrase: identity.passphrase,
      certify: false,
    });
    const { doc, signature } = await signatureDictionaries(sealed);
    expect(doc.catalog.get(name('Perms'))).toBeUndefined();
    expect(signature.get(name('Reference'))).toBeUndefined();
    expect((await verifySeal(sealed)).valid).toBe(true);
  });

  it('only certifies the first signature in a file', () => {
    expect(signatureKind(0, true)).toBe('certification');
    expect(signatureKind(1, true)).toBe('approval');
    expect(signatureKind(0, false)).toBe('approval');
  });
});

describe('seal certificate profile', () => {
  it('seals with a leaf issued by a private root and embeds the chain', async () => {
    const leaf = createTestP12({ commonName: 'Seal Leaf', issuer: root, profile: 'seal-leaf' });
    const sealed = await seal(pdf, { p12: leaf.p12, passphrase: leaf.passphrase });
    const certificates = embeddedCertificates(sealed);
    expect(certificates.map((cert) => cert.subject.getField('CN')?.value)).toEqual([
      'Seal Leaf',
      'Codevibe Test Root',
    ]);
    const result = await verify(sealed, { trust: { roots: [root.certificatePem] } });
    expect(result).toMatchObject({ valid: true, trustedBy: 'root' });
  });

  it('keeps unrelated certificates in the file out of the seal', async () => {
    const mixed = createTestP12({ withExtraCertificate: true, commonName: 'Only Me' });
    const sealed = await seal(pdf, { p12: mixed.p12, passphrase: mixed.passphrase });
    expect(embeddedCertificates(sealed)).toHaveLength(1);
  });

  it('still accepts the older single self-signed certificate with CA:TRUE', async () => {
    const legacy = createTestP12({ profile: 'self-signed-ca' });
    const sealed = await seal(pdf, { p12: legacy.p12, passphrase: legacy.passphrase });
    expect((await verifySeal(sealed)).valid).toBe(true);
  });

  it('refuses a CA certificate issued by a root as the seal', async () => {
    const leaf = createTestP12({ issuer: root, profile: 'ca-leaf' });
    const error = await rejection(seal(pdf, { p12: leaf.p12, passphrase: leaf.passphrase }));
    expect(error.code).toBe('SEAL_FAILED');
    expect(error.details).toMatchObject({ reason: 'ca_certificate' });
  });

  it('refuses a certificate whose extended key usage is not document signing', async () => {
    const server = createTestP12({ profile: 'server-auth' });
    const error = await rejection(seal(pdf, { p12: server.p12, passphrase: server.passphrase }));
    expect(error.details).toMatchObject({ reason: 'extended_key_usage' });
  });

  it('refuses a chain whose issuer did not sign the seal certificate', async () => {
    const leaf = p12Signer({ p12: identity.p12, passphrase: identity.passphrase });
    const other = createTestCa('Some Other Root');
    const broken: SealProvider = {
      kind: 'custom',
      certificateChain: async () => [
        ...(await leaf.certificateChain()),
        new Uint8Array(
          Buffer.from(
            forge.asn1.toDer(forge.pki.certificateToAsn1(other.certificate)).getBytes(),
            'binary',
          ),
        ),
      ],
      sign: (data) => leaf.sign(data),
    };
    const error = await rejection(seal(pdf, { signer: broken }));
    expect(error.details).toMatchObject({ reason: 'chain' });
  });
});

describe('seal providers', () => {
  it('signs through any SealProvider', async () => {
    const inner = p12Signer({ p12: identity.p12, passphrase: identity.passphrase });
    const calls: number[] = [];
    const custom: SealProvider = {
      kind: 'custom',
      certificateChain: () => inner.certificateChain(),
      sign: async (data) => {
        calls.push(data.length);
        return inner.sign(data);
      },
    };
    const sealed = await seal(pdf, { signer: custom });
    expect(calls).toHaveLength(1);
    const result = await verify(sealed, { trust: { certificates: [identity.certificatePem] } });
    expect(result.valid).toBe(true);
  });

  it.each([
    ['pkcs11', pkcs11Signer({ module: '/usr/lib/softhsm/libsofthsm2.so' })],
    [
      'csc',
      cscSigner({
        serviceUrl: 'https://cs.example.com/csc/v1',
        credentialId: 'x',
        accessToken: 't',
      }),
    ],
  ])('reports the %s provider as not configured', async (kind, signer) => {
    const error = await rejection(seal(pdf, { signer }));
    expect(error.code).toBe('SEAL_FAILED');
    expect(error.message).toMatch(/not configured/);
    expect(error.details).toEqual({ option: 'signer', provider: kind });
  });

  it('needs a p12 file or a signer', async () => {
    const error = await rejection(seal(pdf, {}));
    expect(error.code).toBe('SEAL_FAILED');
  });
});
