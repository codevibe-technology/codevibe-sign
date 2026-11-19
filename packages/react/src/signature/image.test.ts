import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFieldValue, MAX_IMAGE_BYTES, SignError } from '@codevibe/sign-core';
import { mockPngBytes, paperCanvas, pixelsOf } from '../test/canvas';
import {
  base64Size,
  encodeSignature,
  findContentBounds,
  fitWithin,
  imageFileToSignature,
  isPaper,
} from './image';

function lastCanvas(spy: { mock: { results: Array<{ value: unknown }> } }): HTMLCanvasElement {
  const results = spy.mock.results.filter((r) => (r.value as Element).tagName === 'CANVAS');
  return results[results.length - 1]!.value as HTMLCanvasElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('findContentBounds', () => {
  it('finds the box around non-background pixels', () => {
    const canvas = paperCanvas(40, 20, { x: 10, y: 5, width: 8, height: 4 });
    const { data } = pixelsOf(canvas);
    expect(findContentBounds(data, 40, 20, isPaper)).toEqual({ x: 10, y: 5, width: 8, height: 4 });
  });

  it('returns null for a blank image', () => {
    expect(findContentBounds(new Uint8ClampedArray(4 * 9), 3, 3)).toBeNull();
  });
});

describe('fitWithin and base64Size', () => {
  it('only ever scales down', () => {
    expect(fitWithin(100, 50, 1200, 400)).toEqual({ width: 100, height: 50 });
    expect(fitWithin(2400, 400, 1200, 400)).toEqual({ width: 1200, height: 200 });
  });

  it('counts decoded bytes', () => {
    expect(base64Size(btoa('abc'))).toBe(3);
    expect(base64Size(btoa('abcd'))).toBe(4);
    expect(base64Size(btoa('abcde'))).toBe(5);
  });
});

describe('encodeSignature', () => {
  it('trims to the content plus padding and drops the data URL prefix', () => {
    const create = vi.spyOn(document, 'createElement');
    const source = document.createElement('canvas');
    source.width = 300;
    source.height = 100;
    const ctx = source.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(100, 40, 50, 20);

    const png = encodeSignature(source, { padding: 4 })!;
    const out = lastCanvas(create);
    expect([out.width, out.height]).toEqual([58, 28]);
    expect(png.startsWith('data:')).toBe(false);
    expect(base64Size(png)).toBe(mockPngBytes(58, 28));
    expect(checkFieldValue('signature', png).ok).toBe(true);
  });

  it('returns null for an empty canvas', () => {
    const source = document.createElement('canvas');
    source.width = 50;
    source.height = 50;
    expect(encodeSignature(source)).toBeNull();
  });

  it('scales down until the PNG fits the byte cap', () => {
    const create = vi.spyOn(document, 'createElement');
    const source = document.createElement('canvas');
    source.width = 400;
    source.height = 200;
    const ctx = source.getContext('2d')!;
    ctx.fillRect(0, 0, 400, 200);

    const png = encodeSignature(source, { padding: 0, maxBytes: 8000 })!;
    const out = lastCanvas(create);
    expect(base64Size(png)).toBeLessThanOrEqual(8000);
    expect(out.width).toBeLessThan(400);
    expect(out.width / out.height).toBeCloseTo(2, 1);
  });

  it('never goes above the core limit even when asked to', () => {
    const source = document.createElement('canvas');
    source.width = 1200;
    source.height = 2000;
    source.getContext('2d')!.fillRect(0, 0, 1200, 2000);
    const png = encodeSignature(source, {
      padding: 0,
      maxWidth: 1200,
      maxHeight: 2000,
      maxBytes: 10_000_000,
    })!;
    expect(base64Size(png)).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
  });

  it('fails with a typed error when the image cannot be made small enough', () => {
    const source = document.createElement('canvas');
    source.width = 100;
    source.height = 100;
    source.getContext('2d')!.fillRect(0, 0, 100, 100);
    expect(() => encodeSignature(source, { maxBytes: 10 })).toThrowError(SignError);
    try {
      encodeSignature(source, { maxBytes: 10 });
    } catch (error) {
      expect((error as SignError).code).toBe('VALIDATION');
      expect((error as SignError).details).toEqual({ reason: 'too_large' });
    }
  });
});

describe('imageFileToSignature', () => {
  const photo = (type = 'image/jpeg', size = 1000) =>
    new File([new Uint8Array(size)], 'sig.jpg', { type });

  it('decodes, removes the paper, trims and re-encodes as PNG', async () => {
    const decoded = paperCanvas(400, 200, { x: 100, y: 80, width: 120, height: 30 });
    const bitmap = vi.fn(async () => decoded);
    vi.stubGlobal('createImageBitmap', bitmap);
    const create = vi.spyOn(document, 'createElement');

    const png = await imageFileToSignature(photo(), { padding: 0 });
    const out = lastCanvas(create);
    expect(bitmap).toHaveBeenCalledOnce();
    expect([out.width, out.height]).toEqual([120, 30]);
    expect(checkFieldValue('signature', png).ok).toBe(true);
    const corner = pixelsOf(out).data.subarray(0, 4);
    expect(corner[3]).toBe(255);
    const cleaned = create.mock.results
      .map((r) => r.value as HTMLCanvasElement)
      .find(
        (c) =>
          c.tagName === 'CANVAS' && c.width === 400 && c !== decoded && pixelsOf(c).data[3] === 0,
      );
    expect(cleaned).toBeDefined();
  });

  it('rejects files that are not PNG, JPEG or WebP', async () => {
    await expect(imageFileToSignature(photo('image/svg+xml'))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'not_image' },
    });
  });

  it('rejects files over the size limit before decoding', async () => {
    const bitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', bitmap);
    await expect(
      imageFileToSignature(photo('image/png', 2000), { maxFileBytes: 1000 }),
    ).rejects.toMatchObject({
      details: { reason: 'file_too_large' },
    });
    expect(bitmap).not.toHaveBeenCalled();
  });

  it('reports unreadable and blank images', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('bad data'))),
    );
    await expect(imageFileToSignature(photo())).rejects.toMatchObject({
      details: { reason: 'unreadable' },
    });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => paperCanvas(50, 50, { x: 0, y: 0, width: 0, height: 0 })),
    );
    await expect(imageFileToSignature(photo())).rejects.toMatchObject({
      details: { reason: 'blank' },
    });
  });
});
