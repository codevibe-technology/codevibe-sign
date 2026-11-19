import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Hasher } from '@codevibe_technology/sign-core';

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export const nodeHasher: Hasher = {
  sha256: async (data) => sha256Hex(data),
};

export function hmacSha256Hex(secret: string | Uint8Array, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Compares two strings without leaking where they differ or their length. */
export function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}
