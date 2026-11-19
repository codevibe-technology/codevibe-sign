import { deflateSync, inflateSync } from 'node:zlib';
import { MAX_IMAGE_DIMENSION } from '@codevibe_technology/sign-core';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bit depths allowed for each PNG colour type. */
const BIT_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Adam7 passes: x start, y start, x step, y step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Raised for any PNG that is malformed or over a limit; callers map it to their own error. */
export class PngRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PngRejected';
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.byteLength, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  raw: Buffer;
}

function readHeader(data: Buffer, maxDimension: number): Header {
  if (data.byteLength !== 13) throw new PngRejected('bad header');
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const [bitDepth, colorType, compression, filter, interlace] = [...data.subarray(8, 13)] as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (width === 0 || height === 0 || width > maxDimension || height > maxDimension) {
    throw new PngRejected('dimensions');
  }
  if (!BIT_DEPTHS[colorType]?.includes(bitDepth)) throw new PngRejected('colour type');
  if (compression !== 0 || filter !== 0 || interlace > 1) throw new PngRejected('method');
  return { width, height, bitDepth, colorType, interlace, raw: data };
}

/** Rows of each (sub)image: [row count, bytes per row without the filter byte]. */
function scanlines(header: Header): [number, number][] {
  const bitsPerPixel = header.bitDepth * (CHANNELS[header.colorType] ?? 1);
  const rowBytes = (width: number) => Math.ceil((width * bitsPerPixel) / 8);
  if (header.interlace === 0) {
    return [[header.height, rowBytes(header.width)]];
  }
  return ADAM7.map(([x0, y0, dx, dy]): [number, number] => {
    const width = Math.ceil((header.width - x0) / dx);
    const height = Math.ceil((header.height - y0) / dy);
    return width > 0 && height > 0 ? [height, rowBytes(width)] : [0, 0];
  }).filter(([rows]) => rows > 0);
}

/**
 * Decodes a PNG's structure and compressed data under hard limits and writes a new PNG with
 * only the image itself: the header, the palette and transparency when the image needs them,
 * and freshly compressed pixel data. Text, colour profiles and every other ancillary chunk are
 * dropped. The pixel data must inflate to exactly the size the header implies, and every
 * scanline must use a valid filter, so a small file cannot expand into a large one.
 */
export function reencodePng(
  input: Uint8Array,
  options: { maxDimension?: number } = {},
): Uint8Array {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength < SIGNATURE.byteLength || !bytes.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngRejected('signature');
  }
  const maxDimension = options.maxDimension ?? MAX_IMAGE_DIMENSION;

  let header: Header | undefined;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const data: Buffer[] = [];
  let ended = false;
  let offset = 8;
  while (offset < bytes.byteLength && !ended) {
    if (offset + 12 > bytes.byteLength) throw new PngRejected('truncated');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.byteLength) throw new PngRejected('truncated');
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(end - 4)) {
      throw new PngRejected('checksum');
    }
    if (!header && type !== 'IHDR') throw new PngRejected('header first');
    switch (type) {
      case 'IHDR':
        if (header) throw new PngRejected('two headers');
        header = readHeader(body, maxDimension);
        break;
      case 'PLTE':
        palette = body;
        break;
      case 'tRNS':
        transparency = body;
        break;
      case 'IDAT':
        data.push(body);
        break;
      case 'IEND':
        ended = true;
        break;
      default:
        // An unknown critical chunk (upper-case first letter) means we cannot render it.
        if (/^[A-Z]/.test(type)) throw new PngRejected('unknown critical chunk');
    }
    offset = end;
  }
  if (!header || !ended || data.length === 0) throw new PngRejected('incomplete');
  if (header.colorType === 3 && !palette) throw new PngRejected('palette missing');

  const passes = scanlines(header);
  const expected = passes.reduce((total, [rows, rowBytes]) => total + rows * (rowBytes + 1), 0);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  } catch {
    throw new PngRejected('pixel data');
  }
  if (pixels.byteLength !== expected) throw new PngRejected('pixel data size');
  let position = 0;
  for (const [rows, rowBytes] of passes) {
    for (let row = 0; row < rows; row += 1) {
      if ((pixels[position] ?? 255) > 4) throw new PngRejected('filter');
      position += rowBytes + 1;
    }
  }

  return new Uint8Array(
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header.raw),
      ...(header.colorType === 3 && palette ? [chunk('PLTE', palette)] : []),
      ...(transparency && header.colorType !== 4 && header.colorType !== 6
        ? [chunk('tRNS', transparency)]
        : []),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}
