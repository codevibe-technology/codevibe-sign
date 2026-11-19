import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sha256Hex } from '../crypto';
import { authenticate, normalizeApiKeys } from './auth';
import { clientIp, type ProxyTrust } from './client';
import { memoryRateLimiter } from './rate-limit';
import { issueSession, verifySession } from './session';

describe('authenticate', () => {
  const keys = normalizeApiKeys([
    'first-key-0123456789',
    { id: 'ops', key: 'second-key-0123456789' },
  ]);

  it('returns the id of the matching key', () => {
    expect(authenticate('Bearer second-key-0123456789', keys)).toEqual({
      id: 'ops',
      workspaceId: 'default',
    });
    expect(authenticate('Bearer first-key-0123456789', keys).id).toMatch(/^key_[0-9a-f]{12}$/);
  });

  it('rejects missing, malformed and unknown keys', () => {
    for (const header of [undefined, '', 'Basic abc', 'Bearer', 'Bearer first-key-012345678']) {
      expect(() => authenticate(header, keys)).toThrow(/API key/);
    }
  });

  it('refuses short or missing keys at start-up', () => {
    expect(() => normalizeApiKeys([])).toThrow();
    expect(() => normalizeApiKeys(['short'])).toThrow(/too short/);
    expect(() => normalizeApiKeys([{ id: 'ops', sha256: 'abc' }])).toThrow(/64 hex/);
  });

  it('keeps only hashes of the keys', () => {
    const stored = normalizeApiKeys([
      'first-key-0123456789',
      { id: 'ops', key: 'second-key-0123456789' },
    ]);
    const kept = JSON.stringify(
      stored.map((key) => ({ ...key, sha256: key.sha256.toString('latin1') })),
    );
    expect(kept).not.toContain('first-key');
    expect(kept).not.toContain('second-key');
    expect(stored[1]?.sha256.toString('hex')).toBe(sha256Hex('second-key-0123456789'));
  });

  it('accepts keys configured as their SHA-256', () => {
    const hashed = normalizeApiKeys([
      { id: 'ci', sha256: sha256Hex('third-key-0123456789').toUpperCase() },
    ]);
    expect(authenticate('Bearer third-key-0123456789', hashed).id).toBe('ci');
    expect(() => authenticate(`Bearer ${sha256Hex('third-key-0123456789')}`, hashed)).toThrow();
  });

  it('puts a key in its configured workspace', () => {
    const scoped = normalizeApiKeys([
      { id: 'acme', key: 'acme-key-0123456789', workspaceId: 'ws_acme' },
    ]);
    expect(authenticate('Bearer acme-key-0123456789', scoped)).toEqual({
      id: 'acme',
      workspaceId: 'ws_acme',
    });
  });

  it('allows no configured keys only when told to', () => {
    expect(() => normalizeApiKeys([])).toThrow(/At least one API key/);
    expect(normalizeApiKeys([], true)).toEqual([]);
    expect(() => authenticate('Bearer anything-0123456789', [])).toThrow(/not valid/);
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

describe('clientIp', () => {
  async function ipFor(forwarded: string | undefined, proxy: ProxyTrust): Promise<string> {
    const app = new Hono();
    app.get('/', (c) => c.text(clientIp(c, proxy)));
    const env = { incoming: { socket: { remoteAddress: '10.0.0.5' } } };
    const headers: Record<string, string> = forwarded ? { 'x-forwarded-for': forwarded } : {};
    return (await app.request('/', { headers }, env)).text();
  }

  it('uses the socket address unless the proxy is trusted', async () => {
    expect(await ipFor('203.0.113.9', { trustProxy: false, trustedProxyHops: 1 })).toBe('10.0.0.5');
  });

  it('takes the entry the trusted proxy added, not one the client sent', async () => {
    const one = { trustProxy: true, trustedProxyHops: 1 };
    expect(await ipFor('203.0.113.9', one)).toBe('203.0.113.9');
    expect(await ipFor('1.2.3.4, 203.0.113.9', one)).toBe('203.0.113.9');
    expect(await ipFor('1.2.3.4, 203.0.113.9', { trustProxy: true, trustedProxyHops: 2 })).toBe(
      '1.2.3.4',
    );
    expect(
      await ipFor('6.6.6.6, 1.2.3.4, 198.51.100.7', { trustProxy: true, trustedProxyHops: 2 }),
    ).toBe('1.2.3.4');
  });

  it('falls back to the socket address for missing or malformed entries', async () => {
    const one = { trustProxy: true, trustedProxyHops: 1 };
    expect(await ipFor(undefined, one)).toBe('10.0.0.5');
    expect(await ipFor('1.2.3.4, not-an-ip', one)).toBe('10.0.0.5');
  });
});
