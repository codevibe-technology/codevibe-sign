import { describe, expect, it } from 'vitest';
import { cryptoRandom } from './defaults';
import type { Clock, RandomSource } from './ports';
import {
  createOtp,
  createSigningToken,
  hashToken,
  OTP_MAX_ATTEMPTS,
  verifyOtp,
  verifyToken,
  isSigningTokenShape,
  type OtpState,
} from './security';
import { SignError } from './types';

const clockAt = (iso: string): Clock => ({ now: () => new Date(iso) });
const T0 = '2026-03-01T10:00:00.000Z';

function sequenceRandom(chunks: number[][]): RandomSource {
  let call = 0;
  return {
    bytes(length) {
      const chunk = chunks[call++] ?? [];
      return Uint8Array.from({ length }, (_, i) => chunk[i] ?? 0);
    },
  };
}

describe('signing tokens', () => {
  it('creates a 32-byte base64url token and its hash', () => {
    const { token, tokenHash } = createSigningToken(cryptoRandom);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(tokenHash);
  });

  it('gives different tokens each time', () => {
    expect(createSigningToken(cryptoRandom).token).not.toBe(createSigningToken(cryptoRandom).token);
  });

  it('verifies only the matching token', () => {
    const { token, tokenHash } = createSigningToken(cryptoRandom);
    expect(verifyToken(token, tokenHash)).toBe(true);
    expect(verifyToken(token + 'x', tokenHash)).toBe(false);
    expect(verifyToken('', tokenHash)).toBe(false);
  });

  it('refuses malformed or oversized tokens without hashing them', () => {
    const { token } = createSigningToken(cryptoRandom);
    const huge = 'A'.repeat(5_000_000);
    expect(verifyToken(huge, hashToken(huge))).toBe(false);
    expect(verifyToken(`${token} `, hashToken(`${token} `))).toBe(false);
    expect(verifyToken(token.replace(/.$/, '='), hashToken(token.replace(/.$/, '=')))).toBe(false);
    expect(verifyToken(token.slice(1), hashToken(token.slice(1)))).toBe(false);
  });

  it('tells token-shaped input from anything else', () => {
    const { token } = createSigningToken(cryptoRandom);
    expect(isSigningTokenShape(token)).toBe(true);
    for (const bad of ['', token.slice(1), `${token}A`, token.replace(/.$/, '+'), 42, null]) {
      expect(isSigningTokenShape(bad)).toBe(false);
    }
  });
});

describe('createOtp', () => {
  it('issues a 6-digit code that expires in 10 minutes', () => {
    const otp = createOtp(cryptoRandom, clockAt(T0));
    expect(otp.code).toMatch(/^\d{6}$/);
    expect(otp.expiresAt).toBe('2026-03-01T10:10:00.000Z');
    expect(otp.state).toMatchObject({ attempts: 0, issuedAt: T0, codeHash: otp.codeHash });
    expect(JSON.stringify(otp.state)).not.toContain(otp.code);
  });

  it('pads small values with leading zeros', () => {
    const otp = createOtp(sequenceRandom([[0, 0, 0, 42]]), clockAt(T0));
    expect(otp.code).toBe('000042');
  });

  it('rejects values in the biased tail and draws again', () => {
    const otp = createOtp(
      sequenceRandom([
        [0xff, 0xff, 0xff, 0xff],
        [0, 0, 0x30, 0x39],
      ]),
      clockAt(T0),
    );
    expect(otp.code).toBe('012345');
  });

  it('salts each code so equal codes hash differently', () => {
    const a = createOtp(sequenceRandom([[0, 0, 0, 1], [1]]), clockAt(T0));
    const b = createOtp(sequenceRandom([[0, 0, 0, 1], [2]]), clockAt(T0));
    expect(a.code).toBe(b.code);
    expect(a.codeHash).not.toBe(b.codeHash);
  });
});

describe('verifyOtp', () => {
  const issue = () => createOtp(cryptoRandom, clockAt(T0));
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

  it('accepts the right code once', () => {
    const otp = issue();
    const first = verifyOtp(otp.state, otp.code, clockAt('2026-03-01T10:05:00.000Z'));
    expect(first.ok).toBe(true);
    expect(first.state.usedAt).toBe('2026-03-01T10:05:00.000Z');
    const again = verifyOtp(first.state, otp.code, clockAt('2026-03-01T10:06:00.000Z'));
    expect(again).toMatchObject({ ok: false, code: 'OTP_INVALID' });
  });

  it('tolerates surrounding whitespace', () => {
    const otp = issue();
    expect(verifyOtp(otp.state, ` ${otp.code} `, clockAt(T0)).ok).toBe(true);
  });

  it('counts a wrong code as a failed attempt', () => {
    const otp = issue();
    const result = verifyOtp(otp.state, wrong(otp.code), clockAt(T0));
    expect(result).toMatchObject({ ok: false, code: 'OTP_INVALID', attemptsLeft: 4 });
    expect(result.state.attempts).toBe(1);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SignError);
      expect(result.error.code).toBe('OTP_INVALID');
    }
  });

  it('counts malformed input as a failed attempt', () => {
    const otp = issue();
    for (const input of ['', '12345', '1234567', 'abcdef']) {
      const result = verifyOtp(otp.state, input, clockAt(T0));
      expect(result).toMatchObject({ ok: false, code: 'OTP_INVALID' });
      expect(result.state.attempts).toBe(1);
    }
  });

  it('locks after five wrong attempts, even for the right code', () => {
    const otp = issue();
    let state: OtpState = otp.state;
    const codes: string[] = [];
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const result = verifyOtp(state, wrong(otp.code), clockAt(T0));
      codes.push(result.ok ? 'ok' : result.code);
      state = result.state;
    }
    expect(codes).toEqual([
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_LOCKED',
    ]);
    const locked = verifyOtp(state, otp.code, clockAt(T0));
    expect(locked).toMatchObject({ ok: false, code: 'OTP_LOCKED', attemptsLeft: 0 });
    expect(locked.state.attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it('accepts the right code on the fifth try', () => {
    const otp = issue();
    let state: OtpState = otp.state;
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++)
      state = verifyOtp(state, wrong(otp.code), clockAt(T0)).state;
    expect(verifyOtp(state, otp.code, clockAt(T0)).ok).toBe(true);
  });

  it('rejects the code at and after the expiry time', () => {
    const otp = issue();
    expect(verifyOtp(otp.state, otp.code, clockAt('2026-03-01T10:09:59.999Z')).ok).toBe(true);
    const expired = verifyOtp(otp.state, otp.code, clockAt('2026-03-01T10:10:00.000Z'));
    expect(expired).toMatchObject({ ok: false, code: 'OTP_EXPIRED' });
    expect(expired.state.attempts).toBe(0);
  });
});
