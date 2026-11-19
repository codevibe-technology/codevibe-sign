import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { SignError } from '@codevibe/sign-core';
import { appendCertificate } from './certificate';
import { renderFields } from './render';
import { seal } from './seal';
import { createTestP12, type TestP12 } from './testing/p12';
import {
  A4,
  document,
  envelope,
  event,
  field,
  makePdf,
  pngBase64,
  recipient,
} from './testing/fixtures';
import { parsePdfDate, verifySeal } from './verify';

const signingTime = new Date('2026-11-19T10:20:30.000Z');
let identity: TestP12;
let sealed: Uint8Array;

beforeAll(async () => {
  identity = createTestP12({ commonName: 'Codevibe Sign Seal', organization: 'Codevibe' });
  sealed = await seal(await makePdf([{ size: A4 }, { size: A4 }]), {
    p12: identity.p12,
    passphrase: identity.passphrase,
    reason: 'Signed with Codevibe Sign',
    location: 'Bengaluru',
    contactInfo: 'support@example.com',
    signingTime,
  });
});

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

function byteRange(bytes: Uint8Array): number[] {
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
    Buffer.from(bytes).toString('latin1'),
  );
  return match!.slice(1, 5).map(Number);
}

/** Appends an incremental update that sets a new /Info dictionary, as an editor would. */
function appendIncrementalUpdate(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString('latin1');
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]);
  const root = /\/Root\s+(\d+ \d+ R)/.exec(text)![1];
  const size = Number([...text.matchAll(/\/Size\s+(\d+)/g)].at(-1)![1]);
  const objectOffset = bytes.length + 1;
  const object = `\n${size} 0 obj\n<< /Producer (Another editor) >>\nendobj\n`;
  const xrefOffset = bytes.length + object.length;
  const update =
    object +
    `xref\n${size} 1\n${String(objectOffset).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size ${size + 1} /Root ${root} /Info ${size} 0 R /Prev ${prev} >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([Buffer.from(bytes), Buffer.from(update, 'latin1')]));
}

describe('seal and verifySeal', () => {
  it('produces a valid seal covering the whole document', async () => {
    const result = await verifySeal(sealed);
    expect(result).toEqual({
      sealed: true,
      valid: true,
      coversWholeDocument: true,
      signer: { commonName: 'Codevibe Sign Seal', organization: 'Codevibe' },
      signedAt: signingTime.toISOString(),
      signatureCount: 1,
    });
  });

  it('uses the PAdES baseline sub-filter and keeps the pages', async () => {
    const text = Buffer.from(sealed).toString('latin1');
    expect(text).toContain('/SubFilter /ETSI.CAdES.detached');
    expect(text).toContain('/Reason (Signed with Codevibe Sign)');
    expect(text).toContain('/Location (Bengaluru)');
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(2);
  });

  it('is invalid after any single byte changes', async () => {
    const [, firstLength, secondStart] = byteRange(sealed);
    const positions = [
      0,
      200,
      firstLength! - 5,
      firstLength! + 1,
      firstLength! + 41,
      secondStart! - 3,
      secondStart! + 10,
      sealed.length - 10,
      sealed.length - 1,
    ];
    for (const position of positions) {
      const result = await verifySeal(flip(sealed, position));
      expect(result.valid, `byte ${position}`).toBe(false);
    }
  });

  it('is invalid when the signature hex changes case or padding', async () => {
    const [, firstLength] = byteRange(sealed);
    const text = Buffer.from(sealed).toString('latin1');
    const hexStart = firstLength! + 1;
    const letter = text.slice(hexStart, hexStart + 200).search(/[a-f]/);
    const upper = new Uint8Array(sealed);
    upper[hexStart + letter] = text.charCodeAt(hexStart + letter) - 32;
    expect((await verifySeal(upper)).valid).toBe(false);
  });

  it('reports an appended incremental update as not covering the document', async () => {
    const updated = appendIncrementalUpdate(sealed);
    expect((await PDFDocument.load(updated)).getPageCount()).toBe(2);
    const result = await verifySeal(updated);
    expect(result.sealed).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.coversWholeDocument).toBe(false);
  });

  it('reports unsealed files as not sealed', async () => {
    expect(await verifySeal(await makePdf([{ size: A4 }]))).toEqual({
      sealed: false,
      valid: false,
      coversWholeDocument: false,
      signatureCount: 0,
    });
  });

  it('ignores /ByteRange text that no signature field references', async () => {
    const doc = await PDFDocument.load(await makePdf([{ size: A4 }]));
    doc.context.register(
      doc.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30], Contents: PDFHexString.of('00') }),
    );
    const decoy = await doc.save({ useObjectStreams: false });
    expect(Buffer.from(decoy).toString('latin1')).toContain('/ByteRange');
    expect(await verifySeal(decoy)).toMatchObject({ sealed: false, signatureCount: 0 });
  });

  it('verifies the signature the form declares, not an earlier decoy', async () => {
    const doc = await PDFDocument.load(await makePdf([{ size: A4 }]));
    doc.context.register(
      doc.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30], Contents: PDFHexString.of('00') }),
    );
    const output = await seal(await doc.save({ useObjectStreams: false }), {
      p12: identity.p12,
      passphrase: identity.passphrase,
    });
    const text = Buffer.from(output).toString('latin1');
    expect(text.indexOf('/ByteRange [0 10 20 30]')).toBeLessThan(text.lastIndexOf('/ByteRange'));
    expect(await verifySeal(output)).toMatchObject({ valid: true, coversWholeDocument: true });
  });

  it('counts every signed signature field', async () => {
    const twice = await seal(sealed, { p12: identity.p12, passphrase: identity.passphrase });
    const result = await verifySeal(twice);
    expect(result.signatureCount).toBe(2);
    expect(result.valid).toBe(false);
  });

  it('seals with a key whose certificate is not first in the file', async () => {
    const mixed = createTestP12({ withExtraCertificate: true, commonName: 'Second Cert' });
    const output = await seal(await makePdf([{ size: A4 }]), {
      p12: mixed.p12,
      passphrase: mixed.passphrase,
    });
    const result = await verifySeal(output);
    expect(result.valid).toBe(true);
    expect(result.signer?.commonName).toBe('Second Cert');
  });

  it('rejects a wrong passphrase, a broken file and an expired certificate', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const wrong = await rejection(seal(pdf, { p12: identity.p12, passphrase: 'nope' }));
    expect(wrong.code).toBe('SEAL_FAILED');
    const broken = await rejection(seal(pdf, { p12: new Uint8Array([1, 2, 3]) }));
    expect(broken.code).toBe('SEAL_FAILED');
    const expired = createTestP12({
      notBefore: new Date('2020-01-01T00:00:00Z'),
      notAfter: new Date('2021-01-01T00:00:00Z'),
    });
    const late = await rejection(seal(pdf, { p12: expired.p12, passphrase: expired.passphrase }));
    expect(late.code).toBe('SEAL_FAILED');
    expect(late.details).toMatchObject({ notAfter: '2021-01-01T00:00:00.000Z' });
  });

  it('rejects input that is not a readable PDF', async () => {
    const error = await rejection(
      seal(new Uint8Array([1, 2, 3]), { p12: identity.p12, passphrase: identity.passphrase }),
    );
    expect(error.code).toBe('DOCUMENT_INVALID');
  });

  it('runs the whole pipeline: render, certificate, seal, verify', async () => {
    const signer = recipient();
    const original = await makePdf([{ size: A4 }]);
    const signed = await renderFields(
      original,
      [
        field('signature'),
        field('date_signed', { rect: { x: 50, y: 160, width: 120, height: 20 } }),
      ],
      [{ fieldId: 'f-signature', value: pngBase64(300, 100) }],
      [signer],
    );
    const withCertificate = await appendCertificate(signed, {
      envelope: envelope({ recipients: [signer] }),
      document: document(),
      events: [event(1, 'envelope.created'), event(2, 'recipient.signed', { recipientId: 'r1' })],
    });
    const output = await seal(withCertificate, {
      p12: identity.p12,
      passphrase: identity.passphrase,
    });
    const result = await verifySeal(output);
    expect(result.valid).toBe(true);
    expect(result.coversWholeDocument).toBe(true);
    expect((await PDFDocument.load(output)).getPageCount()).toBe(2);
  });

  it.skipIf(!hasOpenssl())('produces CMS that OpenSSL verifies against the signed bytes', () => {
    const [start, firstLength, secondStart, secondLength] = byteRange(sealed) as [
      number,
      number,
      number,
      number,
    ];
    const buffer = Buffer.from(sealed);
    const content = Buffer.concat([
      buffer.subarray(start, start + firstLength),
      buffer.subarray(secondStart, secondStart + secondLength),
    ]);
    const hex = buffer.subarray(start + firstLength + 1, secondStart - 1).toString('latin1');
    const der = Buffer.from(hex, 'hex');
    const directory = mkdtempSync(join(tmpdir(), 'sign-pdf-'));
    try {
      writeFileSync(join(directory, 'content.bin'), content);
      writeFileSync(join(directory, 'signature.der'), der);
      const output = execFileSync(
        'openssl',
        [
          'cms',
          '-verify',
          '-binary',
          '-inform',
          'DER',
          '-in',
          join(directory, 'signature.der'),
          '-content',
          join(directory, 'content.bin'),
          '-noverify',
          '-out',
          join(directory, 'out.bin'),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      expect(output).toBeDefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('parsePdfDate', () => {
  it('reads PDF dates with and without offsets', () => {
    expect(parsePdfDate('D:20261119102030Z')).toBe('2026-11-19T10:20:30.000Z');
    expect(parsePdfDate("D:20261119155030+05'30'")).toBe('2026-11-19T10:20:30.000Z');
    expect(parsePdfDate('D:2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(parsePdfDate('yesterday')).toBeUndefined();
  });
});

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
