import { builtinModules } from 'node:module';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { SignError } from '@codevibe_technology/sign-core';
import workerSource from 'virtual:limits-worker';
import { inspectPdf } from './inspect';
import { checkParseLimits, DEFAULT_PARSE_LIMITS } from './limits';
import { A4, makePdf } from './testing/fixtures';

async function rejection(promise: Promise<unknown>): Promise<SignError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignError);
  return error as SignError;
}

async function withObject(build: (doc: PDFDocument) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf([{ size: A4 }]));
  build(doc);
  return doc.save({ useObjectStreams: false });
}

describe('checkParseLimits', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_PARSE_LIMITS).toEqual({
      maxPages: 500,
      maxObjects: 100_000,
      maxDepth: 64,
      maxDecodedBytes: 50 * 1024 * 1024,
      timeoutMs: 10_000,
    });
  });

  it('passes an ordinary file', async () => {
    await expect(checkParseLimits(await makePdf([{ size: A4 }, { size: A4 }]))).resolves.toBe(
      undefined,
    );
  });

  it('refuses too many pages', async () => {
    const pdf = await makePdf([{ size: A4 }, { size: A4 }, { size: A4 }]);
    const error = await rejection(checkParseLimits(pdf, { maxPages: 2 }));
    expect(error.code).toBe('DOCUMENT_INVALID');
    expect(error.details).toMatchObject({ reason: 'limit', limit: 'maxPages', max: 2 });
    await expect(checkParseLimits(pdf, { maxPages: 3 })).resolves.toBe(undefined);
  });

  it('refuses too many objects', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const error = await rejection(checkParseLimits(pdf, { maxObjects: 3 }));
    expect(error.details).toMatchObject({ limit: 'maxObjects', max: 3 });
  });

  it('refuses deeply nested objects', async () => {
    const pdf = await withObject((doc) => {
      let nested: unknown[] = [];
      for (let i = 0; i < 80; i++) nested = [nested];
      doc.context.register(doc.context.obj(nested as never));
    });
    const error = await rejection(checkParseLimits(pdf));
    expect(error.details).toMatchObject({ limit: 'maxDepth', max: 64 });
  });

  it('refuses compressed streams that inflate past the budget', async () => {
    const pdf = await withObject((doc) => {
      const bomb = deflateSync(Buffer.alloc(2 * 1024 * 1024));
      const dict = doc.context.obj({ Filter: 'FlateDecode', Length: bomb.length });
      doc.context.register(PDFRawStream.of(dict, new Uint8Array(bomb)));
    });
    expect(pdf.byteLength).toBeLessThan(20_000);
    const error = await rejection(checkParseLimits(pdf, { maxDecodedBytes: 1024 * 1024 }));
    expect(error.details).toMatchObject({ limit: 'maxDecodedBytes' });
    await expect(checkParseLimits(pdf, { maxDecodedBytes: 4 * 1024 * 1024 })).resolves.toBe(
      undefined,
    );
  });

  it('refuses a page tree that loops back on itself', async () => {
    const doc = await PDFDocument.create();
    doc.addPage(A4);
    const text = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
    const pages = /(\d+) 0 obj\s*<<\s*\/Type \/Pages/.exec(text)![1];
    const looped = text.replace(/\/Kids \[ (\d+ 0 R) \]/, `/Kids [ $1 ${pages} 0 R ]`);
    expect(looped).not.toBe(text);
    const error = await rejection(checkParseLimits(new Uint8Array(Buffer.from(looped, 'latin1'))));
    expect(error.details).toMatchObject({ reason: 'unreadable' });
  });

  it('kills the worker when the time budget runs out', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const started = Date.now();
    const error = await rejection(checkParseLimits(pdf, { timeoutMs: 1 }));
    expect(error.details).toMatchObject({ reason: 'timeout', timeoutMs: 1 });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('limits worker source', () => {
  it('needs nothing from disk but Node built-ins, so bundling the package cannot break it', () => {
    const required = [...workerSource.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(required).toContain('node:worker_threads');
    for (const id of required) {
      expect(builtinModules).toContain(id?.replace(/^node:/, ''));
    }
  });
});

describe('inspectPdf limits', () => {
  it('applies the parser limits to uploads', async () => {
    const pdf = await makePdf([{ size: A4 }, { size: A4 }]);
    const error = await rejection(inspectPdf(pdf, { limits: { maxPages: 1 } }));
    expect(error.details).toMatchObject({ limit: 'maxPages' });
    expect((await inspectPdf(pdf)).pageCount).toBe(2);
  });
});
