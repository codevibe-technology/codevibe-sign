import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

async function reference(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with Web Crypto across block boundaries', async () => {
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const input = 'x'.repeat(length);
      expect(sha256Hex(input)).toBe(await reference(input));
    }
  });

  it('hashes bytes and multibyte text the same way Web Crypto does', async () => {
    const bytes = new Uint8Array([0, 255, 128, 7]);
    expect(sha256Hex(bytes)).toBe(await reference(bytes));
    expect(sha256Hex('नमस्ते')).toBe(await reference('नमस्ते'));
  });
});
