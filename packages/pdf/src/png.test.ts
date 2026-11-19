import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PngRejected, reencodePng } from './png';
import { makePng, pngChunk } from './testing/fixtures';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function header(width: number, height: number, colorType = 6, bitDepth = 8, interlace = 0) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  data[12] = interlace;
  return data;
}

function png(...chunks: Buffer[]): Uint8Array {
  return new Uint8Array(Buffer.concat([SIGNATURE, ...chunks]));
}

function rgbaRows(width: number, height: number, filter = 0): Buffer {
  const row = Buffer.alloc(1 + width * 4, 0x7f);
  row[0] = filter;
  return Buffer.concat(Array.from({ length: height }, () => row));
}

function chunkTypes(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const types: string[] = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    types.push(buffer.toString('latin1', offset + 4, offset + 8));
    offset += 12 + length;
  }
  return types;
}

describe('reencodePng', () => {
  it('writes a clean PNG with the same pixels and only the chunks it needs', async () => {
    const original = Buffer.from(makePng(30, 10));
    const iend = original.length - 12;
    const withText = Buffer.concat([
      original.subarray(0, iend),
      pngChunk('tEXt', Buffer.from('Comment\0hello')),
      pngChunk('iCCP', Buffer.from('profile\0\0junk')),
      original.subarray(iend),
    ]);
    const output = reencodePng(new Uint8Array(withText));
    expect(chunkTypes(output)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const pixels = (bytes: Uint8Array) => {
      const types = Buffer.from(bytes);
      const length = types.readUInt32BE(33);
      return inflateSync(types.subarray(41, 41 + length));
    };
    expect(pixels(output)).toEqual(pixels(original));
    const image = await (await PDFDocument.create()).embedPng(output);
    expect([image.width, image.height]).toEqual([30, 10]);
  });

  it('keeps the palette for indexed images and accepts interlaced ones', () => {
    const indexed = png(
      pngChunk('IHDR', header(2, 2, 3, 8)),
      pngChunk('PLTE', Buffer.from([0, 0, 0, 255, 255, 255])),
      pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 1, 0, 1, 0]))),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(chunkTypes(reencodePng(indexed))).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);

    // Adam7 on a 3x3 image leaves passes 2 and 3 empty; [rows, width] of the others.
    const passRows = [
      [1, 1],
      [1, 1],
      [1, 2],
      [2, 1],
      [1, 3],
    ];
    const raw = Buffer.concat(
      passRows.flatMap(([rows, width]) =>
        Array.from({ length: rows! }, () => Buffer.alloc(1 + width! * 4)),
      ),
    );
    const interlaced = png(
      pngChunk('IHDR', header(3, 3, 6, 8, 1)),
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(chunkTypes(reencodePng(interlaced))).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('refuses pixel data that inflates beyond what the header declares', () => {
    const bomb = png(
      pngChunk('IHDR', header(10, 10)),
      pngChunk('IDAT', deflateSync(Buffer.alloc(8 * 1024 * 1024))),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(bomb.byteLength).toBeLessThan(16 * 1024);
    expect(() => reencodePng(bomb)).toThrow(PngRejected);
  });

  it('refuses short pixel data, bad filters, bad checksums and huge canvases', () => {
    const short = png(
      pngChunk('IHDR', header(10, 10)),
      pngChunk('IDAT', deflateSync(rgbaRows(10, 9))),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(() => reencodePng(short)).toThrow(/size/);

    const badFilter = png(
      pngChunk('IHDR', header(4, 4)),
      pngChunk('IDAT', deflateSync(rgbaRows(4, 4, 9))),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(() => reencodePng(badFilter)).toThrow(/filter/);

    const corrupt = Buffer.from(makePng(4, 4));
    corrupt.writeUInt8(corrupt.readUInt8(corrupt.length - 20) ^ 0xff, corrupt.length - 20);
    expect(() => reencodePng(new Uint8Array(corrupt))).toThrow(PngRejected);

    const huge = png(
      pngChunk('IHDR', header(4096, 1)),
      pngChunk('IDAT', deflateSync(Buffer.alloc(1))),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(() => reencodePng(huge)).toThrow(/dimensions/);

    expect(() => reencodePng(new Uint8Array([1, 2, 3]))).toThrow(/signature/);
    const noEnd = png(
      pngChunk('IHDR', header(1, 1)),
      pngChunk('IDAT', deflateSync(rgbaRows(1, 1))),
    );
    expect(() => reencodePng(noEnd)).toThrow(/incomplete/);
  });

  it('refuses unknown critical chunks and impossible colour settings', () => {
    const unknown = png(
      pngChunk('IHDR', header(1, 1)),
      pngChunk('ZZZZ', Buffer.alloc(1)),
      pngChunk('IDAT', deflateSync(rgbaRows(1, 1))),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(() => reencodePng(unknown)).toThrow(/critical/);
    const bad = png(
      pngChunk('IHDR', header(1, 1, 6, 4)),
      pngChunk('IDAT', deflateSync(rgbaRows(1, 1))),
      pngChunk('IEND', Buffer.alloc(0)),
    );
    expect(() => reencodePng(bad)).toThrow(/colour/);
  });
});
