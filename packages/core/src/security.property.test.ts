import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Clock, RandomSource } from './ports';
import {
  createOtp,
  createSigningToken,
  hashToken,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  SIGNING_TOKEN_BYTES,
  verifyOtp,
  verifyToken,
  type OtpState,
} from './security';

const T0 = Date.UTC(2026, 2, 1, 10);

/** Replays the given bytes, then zeros, so every run is reproducible from its seed. */
function bytesSource(seed: Uint8Array): RandomSource {
  let offset = 0;
  return {
    bytes(length) {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = seed[offset++] ?? 0;
      return out;
    },
  };
}

const clockAt = (ms: number): Clock => ({ now: () => new Date(ms) });

const seedBytes = fc.uint8Array({ minLength: 64, maxLength: 64 });

type Guess =
  | { kind: 'right'; afterMs: number; padded: boolean }
  | { kind: 'wrong'; afterMs: number; digits: string }
  | { kind: 'junk'; afterMs: number; text: string };

const afterMs = fc.integer({ min: 0, max: OTP_TTL_MS / 4 });

const guess: fc.Arbitrary<Guess> = fc.oneof(
  fc.record({ kind: fc.constant('right' as const), afterMs, padded: fc.boolean() }),
  fc.record({
    kind: fc.constant('wrong' as const),
    afterMs,
    digits: fc.stringMatching(/^\d{6}$/),
  }),
  fc.record({ kind: fc.constant('junk' as const), afterMs, text: fc.string({ maxLength: 12 }) }),
);

function presented(g: Guess, code: string): string {
  if (g.kind === 'right') return g.padded ? ` ${code}\n` : code;
  if (g.kind === 'wrong') return g.digits;
  return g.text;
}

describe('OTP properties', () => {
  it('codes are always six digits, salted, and expire after the TTL', () => {
    fc.assert(
      fc.property(seedBytes, (seed) => {
        const otp = createOtp(bytesSource(seed), clockAt(T0));
        expect(otp.code).toMatch(/^\d{6}$/);
        expect(otp.state.salt).toMatch(/^[0-9a-f]{32}$/);
        expect(otp.state.codeHash).not.toContain(otp.code);
        expect(Date.parse(otp.expiresAt) - T0).toBe(OTP_TTL_MS);
        expect(otp.state.attempts).toBe(0);
      }),
    );
  });

  it('attempts never go down, rise by at most one, a lock is permanent and a code works once', () => {
    fc.assert(
      fc.property(seedBytes, fc.array(guess, { maxLength: 15 }), (seed, guesses) => {
        const otp = createOtp(bytesSource(seed), clockAt(T0));
        let state: OtpState = otp.state;
        let now = T0;
        let accepted = 0;
        let locked = false;
        for (const g of guesses) {
          now += g.afterMs;
          const before = state;
          const input = presented(g, otp.code);
          const result = verifyOtp(state, input, clockAt(now));
          state = result.state;

          expect(state.attempts).toBeGreaterThanOrEqual(before.attempts);
          expect(state.attempts - before.attempts).toBeLessThanOrEqual(1);
          expect(state.codeHash).toBe(before.codeHash);
          expect(state.expiresAt).toBe(before.expiresAt);
          if (before.usedAt) expect(state.usedAt).toBe(before.usedAt);

          if (locked) {
            expect(result).toMatchObject({ ok: false, code: 'OTP_LOCKED', attemptsLeft: 0 });
          }
          if (result.ok) {
            accepted += 1;
            expect(input.trim()).toBe(otp.code);
            expect(now).toBeLessThan(Date.parse(otp.expiresAt));
            expect(before.attempts).toBeLessThan(OTP_MAX_ATTEMPTS);
          } else {
            expect(result.error.code).toBe(result.code);
            expect(result.attemptsLeft).toBe(Math.max(0, OTP_MAX_ATTEMPTS - state.attempts));
            expect(result.error.message).not.toContain(otp.code);
            expect(JSON.stringify(result.error.details)).not.toContain(otp.code);
          }
          if (now >= Date.parse(otp.expiresAt) && !locked) {
            expect(result).toMatchObject({ ok: false, code: 'OTP_EXPIRED' });
          }
          if (state.attempts >= OTP_MAX_ATTEMPTS) locked = true;
        }
        expect(accepted).toBeLessThanOrEqual(1);
        expect(state.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
      }),
      { numRuns: 500 },
    );
  });

  it('the right code is refused once the code is locked', () => {
    fc.assert(
      fc.property(seedBytes, fc.integer({ min: OTP_MAX_ATTEMPTS, max: 50 }), (seed, attempts) => {
        const otp = createOtp(bytesSource(seed), clockAt(T0));
        const result = verifyOtp({ ...otp.state, attempts }, otp.code, clockAt(T0));
        expect(result).toMatchObject({ ok: false, code: 'OTP_LOCKED' });
        expect(result.state.attempts).toBe(attempts);
      }),
    );
  });

  it('a wrong guess is never accepted, whatever its shape', () => {
    fc.assert(
      fc.property(seedBytes, fc.string({ maxLength: 20 }), (seed, input) => {
        const otp = createOtp(bytesSource(seed), clockAt(T0));
        fc.pre(input.trim() !== otp.code);
        expect(verifyOtp(otp.state, input, clockAt(T0)).ok).toBe(false);
      }),
    );
  });
});

describe('signing token properties', () => {
  const tokenBytes = fc.uint8Array({
    minLength: SIGNING_TOKEN_BYTES,
    maxLength: SIGNING_TOKEN_BYTES,
  });

  it('a token is 43 base64url characters that decode back to the random bytes', () => {
    fc.assert(
      fc.property(tokenBytes, (bytes) => {
        const { token, tokenHash } = createSigningToken(bytesSource(bytes));
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(new Uint8Array(Buffer.from(token, 'base64url'))).toEqual(bytes);
        expect(verifyToken(token, tokenHash)).toBe(true);
      }),
    );
  });

  it('different random bytes always give different tokens and hashes', () => {
    fc.assert(
      fc.property(tokenBytes, tokenBytes, (a, b) => {
        fc.pre(Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0);
        const ta = createSigningToken(bytesSource(a));
        const tb = createSigningToken(bytesSource(b));
        expect(ta.token).not.toBe(tb.token);
        expect(ta.tokenHash).not.toBe(tb.tokenHash);
        expect(verifyToken(ta.token, tb.tokenHash)).toBe(false);
      }),
    );
  });

  it('only the exact token verifies against its hash', () => {
    fc.assert(
      fc.property(tokenBytes, fc.string({ maxLength: 60 }), (bytes, other) => {
        const { token, tokenHash } = createSigningToken(bytesSource(bytes));
        fc.pre(other !== token);
        expect(verifyToken(other, tokenHash)).toBe(false);
      }),
    );
  });

  it('a stored hash cannot be presented as a token', () => {
    fc.assert(
      fc.property(tokenBytes, (bytes) => {
        const { tokenHash } = createSigningToken(bytesSource(bytes));
        expect(verifyToken(tokenHash, tokenHash)).toBe(false);
        expect(verifyToken(tokenHash, hashToken(tokenHash))).toBe(false);
      }),
    );
  });
});
