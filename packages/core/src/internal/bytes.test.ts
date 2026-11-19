import { describe, expect, it } from 'vitest';
import { constantTimeEqual, fromBase64, toBase64Url } from './bytes';

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

describe('toBase64Url', () => {
  it('matches btoa for every tail length', () => {
    for (const length of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 250) & 0xff);
      expect(toBase64Url(bytes)).toBe(
        base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      );
    }
  });
});

describe('fromBase64', () => {
  it('round-trips with btoa', () => {
    for (const length of [1, 2, 3, 4, 100]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 13) & 0xff);
      expect(fromBase64(base64(bytes))).toEqual(bytes);
    }
  });

  it('rejects malformed input', () => {
    expect(fromBase64('')).toBeNull();
    expect(fromBase64('abc')).toBeNull();
    expect(fromBase64('ab$=')).toBeNull();
    expect(fromBase64('a=bc')).toBeNull();
    expect(fromBase64('ab-_')).toBeNull();
  });
});

describe('constantTimeEqual', () => {
  it('compares strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
