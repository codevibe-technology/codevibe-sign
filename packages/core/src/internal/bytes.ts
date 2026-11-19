const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map<string, number>(Array.from(ALPHABET, (char, index) => [char, index]));

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2]!;
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += ALPHABET[b2 & 0x3f]!;
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

/** Strict standard base64 (padding required). Returns null for anything malformed. */
export function fromBase64(input: string): Uint8Array | null {
  if (input.length === 0 || input.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input)) return null;
  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((input.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < input.length; i += 4) {
    const c0 = LOOKUP.get(input[i]!) ?? 0;
    const c1 = LOOKUP.get(input[i + 1]!) ?? 0;
    const c2 = LOOKUP.get(input[i + 2]!) ?? 0;
    const c3 = LOOKUP.get(input[i + 3]!) ?? 0;
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < out.length) out[o++] = (triple >> 16) & 0xff;
    if (o < out.length) out[o++] = (triple >> 8) & 0xff;
    if (o < out.length) out[o++] = triple & 0xff;
  }
  return out;
}

/** Compares two strings in time that depends only on their lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
