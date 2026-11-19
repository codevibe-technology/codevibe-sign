import { describe, expect, it } from 'vitest';
import { authenticate, normalizeApiKeys } from './auth';
import { memoryRateLimiter } from './rate-limit';
import { issueSession, verifySession } from './session';

describe('authenticate', () => {
  const keys = normalizeApiKeys([
    'first-key-0123456789',
    { id: 'ops', key: 'second-key-0123456789' },
  ]);

  it('returns the id of the matching key', () => {
    expect(authenticate('Bearer second-key-0123456789', keys)).toBe('ops');
    expect(authenticate('Bearer first-key-0123456789', keys)).toMatch(/^key_[0-9a-f]{12}$/);
  });

  it('rejects missing, malformed and unknown keys', () => {
    for (const header of [undefined, '', 'Basic abc', 'Bearer', 'Bearer first-key-012345678']) {
      expect(() => authenticate(header, keys)).toThrow(/API key/);
    }
  });

  it('refuses short or missing keys at start-up', () => {
    expect(() => normalizeApiKeys([])).toThrow();
    expect(() => normalizeApiKeys(['short'])).toThrow(/too short/);
  });
});

describe('memoryRateLimiter', () => {
  it('allows up to the limit per window and reports when to retry', async () => {
    const limiter = memoryRateLimiter();
    const t0 = new Date(0);
    expect((await limiter.hit('k', 2, 1000, t0)).allowed).toBe(true);
    expect((await limiter.hit('k', 2, 1000, new Date(100))).allowed).toBe(true);
    expect(await limiter.hit('k', 2, 1000, new Date(400))).toEqual({
      allowed: false,
      retryAfterMs: 600,
    });
    expect((await limiter.hit('other', 2, 1000, new Date(400))).allowed).toBe(true);
    expect((await limiter.hit('k', 2, 1000, new Date(1000))).allowed).toBe(true);
  });

  it('stays within its key budget', async () => {
    const limiter = memoryRateLimiter({ maxKeys: 2 });
    await limiter.hit('a', 1, 60_000, new Date(0));
    await limiter.hit('b', 1, 60_000, new Date(0));
    await limiter.hit('c', 1, 60_000, new Date(0));
    expect((await limiter.hit('a', 1, 60_000, new Date(1))).allowed).toBe(true);
  });
});

describe('signer sessions', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('accepts its own session for the same token until it expires', () => {
    const { value, expiresAt } = issueSession('secret', 'hash-a', now);
    expect(verifySession('secret', value, 'hash-a', now)).toBe(true);
    expect(verifySession('secret', value, 'hash-b', now)).toBe(false);
    expect(verifySession('other', value, 'hash-a', now)).toBe(false);
    expect(verifySession('secret', value, 'hash-a', expiresAt)).toBe(false);
  });

  it('rejects tampered and malformed values', () => {
    const { value } = issueSession('secret', 'hash-a', now);
    const [payload, sig] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ t: 'hash-a', exp: 9e15 })).toString('base64url');
    expect(verifySession('secret', `${forged}.${sig}`, 'hash-a', now)).toBe(false);
    expect(verifySession('secret', `${payload}`, 'hash-a', now)).toBe(false);
    expect(verifySession('secret', `${value}.x`, 'hash-a', now)).toBe(false);
    expect(verifySession('secret', undefined, 'hash-a', now)).toBe(false);
  });
});
