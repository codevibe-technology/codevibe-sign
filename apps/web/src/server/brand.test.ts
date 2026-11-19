import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, setLogo, sniffImage } from './brand';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error('should not be called');
    },
  },
) as never;

describe('logo checks', () => {
  it('knows images by their bytes', () => {
    expect(sniffImage(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(sniffImage(webp)).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it('refuses empty, oversized and non-image files before storing anything', async () => {
    const cases: [Uint8Array, RegExp][] = [
      [new Uint8Array(), /Choose an image/],
      [new Uint8Array(LOGO_MAX_BYTES + 1).fill(0x89), /under 512 KB/],
      [new TextEncoder().encode('<svg/>'), /PNG, JPEG or WebP/],
    ];
    for (const [bytes, message] of cases) {
      await expect(setLogo(untouched, untouched, 'ws_1', bytes)).rejects.toMatchObject({
        field: 'logo',
        message: expect.stringMatching(message),
      });
    }
  });
});
