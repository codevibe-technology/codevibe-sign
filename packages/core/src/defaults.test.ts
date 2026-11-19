import { describe, expect, it } from 'vitest';
import { cryptoRandom, randomIds, systemClock, webCryptoHasher } from './defaults';

describe('defaults', () => {
  it('hashes strings and bytes to the same lowercase hex', async () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await webCryptoHasher.sha256('abc')).toBe(expected);
    expect(await webCryptoHasher.sha256(new TextEncoder().encode('abc'))).toBe(expected);
  });

  it('gives the current time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('gives random bytes and unique ids', () => {
    expect(cryptoRandom.bytes(32)).toHaveLength(32);
    expect(cryptoRandom.bytes(16)).not.toEqual(cryptoRandom.bytes(16));
    const ids = new Set(Array.from({ length: 100 }, () => randomIds.id()));
    expect(ids.size).toBe(100);
  });
});
