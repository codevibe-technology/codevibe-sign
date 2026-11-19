import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { SignError } from '@codevibe/sign-core';
import { inspectPdf, sha256Hex } from './inspect';
import { A4, makeEncryptedPdf, makePdf } from './testing/fixtures';

async function rejection(promise: Promise<unknown>): Promise<SignError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignError);
  return error as SignError;
}

describe('inspectPdf', () => {
  it('reports page count and page sizes', async () => {
    const bytes = await makePdf([{ size: A4 }, { size: [612, 792] }, { size: [842, 595] }]);
    const info = await inspectPdf(bytes);
    expect(info.pageCount).toBe(3);
    expect(info.pages).toEqual([
      { width: 595.28, height: 841.89 },
      { width: 612, height: 792 },
      { width: 842, height: 595 },
    ]);
  });

  it('reports rotated pages as displayed', async () => {
    const bytes = await makePdf([
      { size: A4, rotation: 90 },
      { size: A4, rotation: -90 },
      { size: A4, rotation: 180 },
    ]);
    const info = await inspectPdf(bytes);
    expect(info.pages).toEqual([
      { width: 841.89, height: 595.28 },
      { width: 841.89, height: 595.28 },
      { width: 595.28, height: 841.89 },
    ]);
  });

  it('uses the crop box when there is one', async () => {
    const bytes = await makePdf([{ size: A4, cropBox: [20, 30, 500, 700] }]);
    const info = await inspectPdf(bytes);
    expect(info.pages[0]).toEqual({ width: 500, height: 700 });
  });

  it('rejects files over the size cap', async () => {
    const bytes = await makePdf([{ size: A4 }]);
    const error = await rejection(inspectPdf(bytes, { maxBytes: bytes.length - 1 }));
    expect(error.code).toBe('DOCUMENT_TOO_LARGE');
    expect(error.details).toMatchObject({ size: bytes.length, maxBytes: bytes.length - 1 });
    await expect(inspectPdf(bytes, { maxBytes: bytes.length })).resolves.toMatchObject({
      pageCount: 1,
    });
  });

  it('rejects encrypted files', async () => {
    const error = await rejection(inspectPdf(await makeEncryptedPdf()));
    expect(error.code).toBe('DOCUMENT_INVALID');
    expect(error.details).toEqual({ reason: 'encrypted' });
  });

  it('rejects a real AES-256 encrypted file', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('./testing/encrypted-aes256.pdf', import.meta.url)),
    );
    const error = await rejection(inspectPdf(bytes));
    expect(error.code).toBe('DOCUMENT_INVALID');
    expect(error.details).toEqual({ reason: 'encrypted' });
  });

  it('rejects files that are not PDFs', async () => {
    const error = await rejection(inspectPdf(new TextEncoder().encode('hello, world')));
    expect(error.code).toBe('DOCUMENT_INVALID');
    expect((await rejection(inspectPdf(new Uint8Array()))).code).toBe('DOCUMENT_INVALID');
  });

  it('rejects broken PDFs', async () => {
    const error = await rejection(
      inspectPdf(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R')),
    );
    expect(error.code).toBe('DOCUMENT_INVALID');
  });

  it('rejects PDFs without pages', async () => {
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    const error = await rejection(inspectPdf(empty));
    expect(error.code).toBe('DOCUMENT_INVALID');
    expect(error.details).toEqual({ reason: 'empty' });
  });
});

describe('sha256Hex', () => {
  it('returns lowercase hex SHA-256', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
