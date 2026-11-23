import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { imageSize, isWideLogo } from './logo-shape';

function png(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.alloc(1))),
    ]),
  );
}

function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x0b, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

function webp(kind: 'VP8X' | 'VP8 ' | 'VP8L', width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from(kind), 12);
  const view = new DataView(bytes.buffer);
  if (kind === 'VP8X') {
    view.setUint32(24, (width - 1) & 0xffffff, true);
    view.setUint32(27, (height - 1) & 0xffffff, true);
  } else if (kind === 'VP8 ') {
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  } else {
    view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  }
  return bytes;
}

describe('imageSize', () => {
  it('reads PNG, JPEG and every kind of WebP', () => {
    expect(imageSize(png(640, 160))).toEqual({ width: 640, height: 160 });
    expect(imageSize(jpeg(300, 300))).toEqual({ width: 300, height: 300 });
    expect(imageSize(webp('VP8X', 900, 200))).toEqual({ width: 900, height: 200 });
    expect(imageSize(webp('VP8 ', 120, 120))).toEqual({ width: 120, height: 120 });
    expect(imageSize(webp('VP8L', 400, 100))).toEqual({ width: 400, height: 100 });
  });

  it('gives up on anything it cannot read', () => {
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull();
    expect(imageSize(png(0, 10))).toBeNull();
  });
});

describe('isWideLogo', () => {
  it('takes a logo twice as wide as tall, or wider, as one that carries the name', () => {
    expect(isWideLogo(400, 200)).toBe(true);
    expect(isWideLogo(399, 200)).toBe(false);
    expect(isWideLogo(200, 200)).toBe(false);
    expect(isWideLogo(null, 200)).toBe(false);
  });
});
