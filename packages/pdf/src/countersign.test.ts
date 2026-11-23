import { PDFDocument, PDFName } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignError } from '@codevibe_technology/sign-core';
import { countersign } from './countersign';
import { seal } from './seal';
import { A4, makeEncryptedPdf, makePdf } from './testing/fixtures';
import { createTestP12, type TestP12 } from './testing/p12';
import {
  createOpensslIdentity,
  hasOpenssl,
  signAsThirdParty,
  type OpensslIdentity,
  type ThirdPartyOptions,
} from './testing/third-party';
import { startFakeTsa } from './testing/tsa';
import { verify } from './trust';
import { verifySeal, verifySignatures } from './verify';

const signingTime = new Date('2026-11-23T10:20:30.000Z');
const openssl = hasOpenssl();
let operator: TestP12;
let esp: TestP12;
let plain: Uint8Array;
const disposable: OpensslIdentity[] = [];

beforeAll(async () => {
  operator = createTestP12({ commonName: 'Codevibe Sign Seal', organization: 'Codevibe' });
  esp = createTestP12({ commonName: 'Asha Rao', organization: 'Test eSign Provider' });
  plain = await makePdf([{ size: A4 }, { size: A4 }]);
});

afterAll(() => {
  for (const identity of disposable) identity.dispose();
});

const sealOptions = () => ({
  p12: operator.p12,
  passphrase: operator.passphrase,
  reason: 'Sealed by Codevibe Sign',
  signingTime,
});
const trust = () => ({ certificates: [operator.certificatePem] });

async function rejection(promise: Promise<unknown>): Promise<SignError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignError);
  return error as SignError;
}

function flip(bytes: Uint8Array, index: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[index] = copy[index] === 0x30 ? 0x31 : 0x30;
  return copy;
}

/** Changes one letter of a text that appears in the file, leaving it a readable PDF. */
function alter(bytes: Uint8Array, text: string): Uint8Array {
  const at = Buffer.from(bytes).lastIndexOf(text, undefined, 'latin1');
  expect(at).toBeGreaterThan(0);
  return flip(bytes, at);
}

const startsWith = (output: Uint8Array, input: Uint8Array) =>
  Buffer.from(output.subarray(0, input.length)).equals(Buffer.from(input));

const thirdParty = (options: Omit<ThirdPartyOptions, 'identity'> = {}) =>
  signAsThirdParty(plain, { identity: esp, ...options });

describe('countersign', () => {
  const layouts: [string, Omit<ThirdPartyOptions, 'identity'>][] = [
    ['a classic cross-reference table', {}],
    ['a cross-reference stream and object streams', { objectStreams: true }],
    ['the form inline in the catalog', { directForm: true }],
    ['the form inline, with object streams', { directForm: true, objectStreams: true }],
    [
      'the fields and annotations as objects of their own',
      {
        indirectFields: true,
        indirectAnnots: true,
      },
    ],
    [
      'indirect arrays and object streams',
      {
        indirectFields: true,
        indirectAnnots: true,
        objectStreams: true,
      },
    ],
    ['a certification that allows signing', { docMdp: 2 }],
    ['a field lock that names other fields', { lock: 'Include' }],
  ];

  it.each(layouts)('keeps both signatures valid for a file with %s', async (_name, layout) => {
    const signed = await thirdParty(layout);
    const output = await countersign(signed, sealOptions());

    expect(startsWith(output, signed)).toBe(true);
    const signatures = await verifySignatures(output);
    expect(signatures).toHaveLength(2);
    expect(signatures[0]).toMatchObject({
      valid: true,
      coversWholeDocument: false,
      coveredBytes: signed.length,
      signer: { commonName: 'Asha Rao', organization: 'Test eSign Provider' },
      issuer: { commonName: 'Asha Rao' },
      subFilter: 'ETSI.CAdES.detached',
    });
    expect(signatures[0]!.certificateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(signatures[1]).toMatchObject({
      valid: true,
      coversWholeDocument: true,
      coveredBytes: output.length,
      signer: { commonName: 'Codevibe Sign Seal', organization: 'Codevibe' },
      signedAt: signingTime.toISOString(),
    });

    const result = await verify(output, { trust: trust(), allowEarlierSignatures: true });
    expect(result).toMatchObject({
      valid: true,
      trustedBy: 'certificate',
      signer: { commonName: 'Codevibe Sign Seal' },
      seal: { valid: true, coversWholeDocument: true, signatureCount: 2 },
    });
    expect(result.earlierSignatures).toEqual([signatures[0]]);

    const reread = await PDFDocument.load(output, { updateMetadata: false });
    expect(reread.getPageCount()).toBe(2);
    expect(
      reread
        .getForm()
        .getFields()
        .map((entry) => entry.getName()),
    ).toEqual(['Seal', 'Seal2']);
  });

  it('continues with the kind of cross-reference section the file ends with', async () => {
    const table = Buffer.from(await countersign(await thirdParty(), sealOptions()));
    const stream = Buffer.from(
      await countersign(await thirdParty({ objectStreams: true }), sealOptions()),
    );
    const tail = (bytes: Buffer, from: number) => bytes.subarray(from).toString('latin1');
    const tableInput = await thirdParty();
    expect(tail(table, tableInput.length)).toMatch(/\nxref\n[\s\S]*trailer\n<< [^>]*\/Prev \d+/);
    expect(tail(stream, stream.length - 400)).toMatch(/\/Type \/XRef [\s\S]*\/Prev \d+/);
    expect(tail(stream, stream.length - 400)).not.toMatch(/trailer/);
  });

  it('still refuses the file as a single seal by default', async () => {
    const output = await countersign(await thirdParty(), sealOptions());
    expect(await verify(output, { trust: trust() })).toMatchObject({
      valid: false,
      reason: 'multiple_signatures',
    });
    expect(await verifySeal(output)).toMatchObject({
      valid: true,
      coversWholeDocument: false,
      signatureCount: 2,
      signer: { commonName: 'Asha Rao' },
    });
  });

  it('detects a change to the part the first signature covers', async () => {
    const signed = await thirdParty();
    const output = await countersign(signed, sealOptions());
    const changed = alter(output, 'Signed by the signer');
    const signatures = await verifySignatures(changed);
    expect(signatures.map((entry) => entry.valid)).toEqual([false, false]);
    expect(await verify(changed, { trust: trust(), allowEarlierSignatures: true })).toMatchObject({
      valid: false,
      reason: 'signature_invalid',
    });
  });

  it('detects a change to the appended part without blaming the first signature', async () => {
    const signed = await thirdParty();
    const output = await countersign(signed, sealOptions());
    const changed = alter(output, 'Sealed by Codevibe Sign');
    const signatures = await verifySignatures(changed);
    expect(signatures.map((entry) => entry.valid)).toEqual([true, false]);
    expect(await verify(changed, { trust: trust(), allowEarlierSignatures: true })).toMatchObject({
      valid: false,
      reason: 'signature_invalid',
    });
  });

  it('reads an earlier signature written in uppercase hex, but not a seal', async () => {
    const upper = (bytes: Uint8Array, from: number) => {
      const copy = Buffer.from(bytes);
      const start = copy.indexOf('/Contents <', from, 'latin1') + '/Contents <'.length;
      const end = copy.indexOf('>', start, 'latin1');
      copy.write(copy.toString('latin1', start, end).toUpperCase(), start, 'latin1');
      return new Uint8Array(copy);
    };
    const signed = upper(await thirdParty(), 0);
    expect((await verifySignatures(signed))[0]!.valid).toBe(true);
    const output = await countersign(signed, sealOptions());
    const options = { trust: trust(), allowEarlierSignatures: true };
    expect(await verify(output, options)).toMatchObject({ valid: true });
    expect(await verify(upper(output, signed.length), options)).toMatchObject({
      valid: false,
      reason: 'signature_invalid',
    });
  });

  it('reports bytes added after the seal', async () => {
    const output = await countersign(await thirdParty(), sealOptions());
    const appended = new Uint8Array(Buffer.concat([Buffer.from(output), Buffer.from('\n%x\n')]));
    expect(await verify(appended, { trust: trust(), allowEarlierSignatures: true })).toMatchObject({
      valid: false,
      reason: 'not_whole_document',
    });
  });

  it('reports a revision slipped in between the earlier signature and the seal', async () => {
    const signed = Buffer.from(await thirdParty());
    const previous = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(signed.toString('latin1'))![1];
    const padded = new Uint8Array(
      Buffer.concat([signed, Buffer.from(`\n% added later\nstartxref\n${previous}\n%%EOF\n`)]),
    );
    const output = await countersign(padded, sealOptions());
    const result = await verify(output, { trust: trust(), allowEarlierSignatures: true });
    expect(result).toMatchObject({ valid: false, reason: 'content_between_signatures' });
    expect(result.seal.valid).toBe(true);
  });

  it('does not take a /Size outside a trailer for an object count', async () => {
    const doc = await PDFDocument.load(plain, { updateMetadata: false });
    const params = doc.context.register(doc.context.obj({ Params: { Size: 8_000_000 } }));
    doc.catalog.set(PDFName.of('CvsTestFile'), params);
    const input = await doc.save({ useObjectStreams: false });
    const signed = await signAsThirdParty(input, { identity: esp });
    const output = await countersign(signed, sealOptions());
    expect(Buffer.from(output).toString('latin1')).not.toMatch(/\b8\d{6} 0 obj/);
    expect(await verify(output, { trust: trust(), allowEarlierSignatures: true })).toMatchObject({
      valid: true,
    });
  });

  it('reports an earlier signature that was already broken when the file was sealed', async () => {
    const broken = alter(await thirdParty(), 'Signed by the signer');
    const output = await countersign(broken, sealOptions());
    const result = await verify(output, { trust: trust(), allowEarlierSignatures: true });
    expect(result).toMatchObject({ valid: false, reason: 'earlier_signature_invalid' });
    expect(result.seal.valid).toBe(true);
    expect(result.earlierSignatures?.[0]?.valid).toBe(false);
  });

  it('does not accept a seal from a certificate that is not trusted', async () => {
    const output = await countersign(await thirdParty(), {
      p12: esp.p12,
      passphrase: esp.passphrase,
    });
    expect(await verify(output, { trust: trust(), allowEarlierSignatures: true })).toMatchObject({
      valid: false,
      reason: 'untrusted_signer',
    });
  });

  it('can be applied again, covering every signature before it', async () => {
    const once = await countersign(await thirdParty({ objectStreams: true }), {
      p12: esp.p12,
      passphrase: esp.passphrase,
    });
    const twice = await countersign(once, sealOptions());
    expect(startsWith(twice, once)).toBe(true);
    const signatures = await verifySignatures(twice);
    expect(signatures.map((entry) => entry.valid)).toEqual([true, true, true]);
    expect(signatures.map((entry) => entry.coversWholeDocument)).toEqual([false, false, true]);
    const result = await verify(twice, { trust: trust(), allowEarlierSignatures: true });
    expect(result.valid).toBe(true);
    expect(result.earlierSignatures).toHaveLength(2);
  });

  it('accepts a file sealed once as one with no earlier signatures', async () => {
    const sealed = await seal(plain, sealOptions());
    const result = await verify(sealed, { trust: trust(), allowEarlierSignatures: true });
    expect(result.valid).toBe(true);
    expect(result.earlierSignatures).toBeUndefined();
  });

  it('refuses a file certified with no changes allowed', async () => {
    const certified = await seal(plain, { p12: esp.p12, passphrase: esp.passphrase });
    const error = await rejection(countersign(certified, sealOptions()));
    expect(error.code).toBe('PDF_ALREADY_SIGNED');
    expect(error.details).toEqual({ reason: 'locked', step: 'countersign' });
  });

  it.each(['All', 'Exclude'] as const)('refuses a file whose signature locks %s', async (lock) => {
    const error = await rejection(countersign(await thirdParty({ lock }), sealOptions()));
    expect(error.code).toBe('PDF_ALREADY_SIGNED');
    expect(error.details).toEqual({ reason: 'locked', step: 'countersign' });
  });

  it('refuses a file that is not signed, encrypted or not a PDF', async () => {
    const unsigned = await rejection(countersign(plain, sealOptions()));
    expect(unsigned.code).toBe('VALIDATION');
    const encrypted = await rejection(countersign(await makeEncryptedPdf(), sealOptions()));
    expect(encrypted).toMatchObject({ code: 'DOCUMENT_INVALID', details: { reason: 'encrypted' } });
    const junk = await rejection(countersign(new TextEncoder().encode('hello'), sealOptions()));
    expect(junk.code).toBe('DOCUMENT_INVALID');
  });

  it('applies the same key checks as seal', async () => {
    const weak = createTestP12({ bits: 1024 });
    const error = await rejection(
      countersign(await thirdParty(), { p12: weak.p12, passphrase: weak.passphrase }),
    );
    expect(error.code).toBe('SEAL_FAILED');
  });

  it('adds a timestamp when an authority is set', async () => {
    const tsa = await startFakeTsa();
    try {
      const output = await countersign(await thirdParty(), { ...sealOptions(), tsaUrl: tsa.url });
      const signatures = await verifySignatures(output);
      expect(signatures[1]).toMatchObject({
        valid: true,
        timestampedAt: tsa.genTime.toISOString(),
      });
      expect(signatures[0]!.timestampedAt).toBeUndefined();
    } finally {
      await tsa.close();
    }
  });
});

describe.skipIf(!openssl)('signatures made by another product', () => {
  it.each(['ec', 'rsa-pss'] as const)(
    'verifies and countersigns a signature made with an %s key',
    async (kind) => {
      const identity = createOpensslIdentity(kind, 'Ravi Kumar');
      disposable.push(identity);
      const signed = await signAsThirdParty(plain, { identity, objectStreams: true });

      expect(await verifySignatures(signed)).toMatchObject([
        {
          valid: true,
          coversWholeDocument: true,
          signer: { commonName: 'Ravi Kumar', organization: 'Test eSign Provider' },
          subFilter: 'adbe.pkcs7.detached',
        },
      ]);
      expect((await verifySignatures(alter(signed, 'Signed by the signer')))[0]!.valid).toBe(false);

      const output = await countersign(signed, sealOptions());
      const result = await verify(output, { trust: trust(), allowEarlierSignatures: true });
      expect(result.valid).toBe(true);
      expect(result.earlierSignatures).toMatchObject([
        { valid: true, signer: { commonName: 'Ravi Kumar' }, coveredBytes: signed.length },
      ]);
    },
  );
});
