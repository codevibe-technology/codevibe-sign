/** Width and height in pixels of a PNG, JPEG or WebP image, read from its header. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (at: number, length: number) => at + length <= bytes.byteLength;
  const ascii = (at: number, text: string) =>
    has(at, text.length) && [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  const size = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;

  if (ascii(1, 'PNG') && ascii(12, 'IHDR') && has(16, 8)) {
    return size(view.getUint32(16), view.getUint32(20));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (has(at, 4)) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const length = view.getUint16(at + 2);
      // SOF0 to SOF15, leaving out DHT (C4), JPG (C8) and DAC (CC).
      const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (frame && has(at + 5, 4)) {
        return size(view.getUint16(at + 7), view.getUint16(at + 5));
      }
      at += 2 + length;
    }
    return null;
  }
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X') && has(24, 6)) {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return size(width, height);
    }
    if (ascii(12, 'VP8 ') && has(26, 4)) {
      return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    }
    if (ascii(12, 'VP8L') && has(21, 4)) {
      const bits = view.getUint32(21, true);
      return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
  }
  return null;
}

/**
 * A logo at least twice as wide as it is tall already carries the name beside its mark, so it
 * is shown on its own; a squarer one is a mark, shown with the name typed next to it.
 */
export const WIDE_LOGO_RATIO = 2;

export function isWideLogo(width: number | null | undefined, height: number | null | undefined) {
  return Boolean(width && height && width / height >= WIDE_LOGO_RATIO);
}
