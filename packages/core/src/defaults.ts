import type { Clock, Hasher, IdGenerator, RandomSource } from './ports';

function webCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error('Web Crypto is not available in this runtime (Node 20+ or a modern browser).');
  }
  return crypto;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const webCryptoHasher: Hasher = {
  async sha256(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return toHex(await webCrypto().subtle.digest('SHA-256', bytes));
  },
};

export const systemClock: Clock = {
  now: () => new Date(),
};

export const cryptoRandom: RandomSource = {
  bytes(length) {
    const out = new Uint8Array(length);
    webCrypto().getRandomValues(out);
    return out;
  },
};

export const randomIds: IdGenerator = {
  id: () => webCrypto().randomUUID(),
};
