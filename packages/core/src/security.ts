import { constantTimeEqual, toBase64Url } from './internal/bytes';
import { sha256Hex } from './internal/sha256';
import type { Clock, RandomSource } from './ports';
import { SignError, type IsoDateTime } from './types';

export const SIGNING_TOKEN_BYTES = 32;
export const OTP_DIGITS = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export interface SigningToken {
  /** Goes into the signing link. Never stored. */
  token: string;
  /** SHA-256 hex of the token; the only thing the server keeps. */
  tokenHash: string;
}

export function createSigningToken(random: RandomSource): SigningToken {
  const token = toBase64Url(random.bytes(SIGNING_TOKEN_BYTES));
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((SIGNING_TOKEN_BYTES * 4) / 3)}}$`);

/**
 * Checks a presented token against a stored hash without leaking timing. Anything that is not
 * shaped like an issued token is refused before hashing, so oversized input costs nothing.
 */
export function verifyToken(token: string, tokenHash: string): boolean {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return false;
  return constantTimeEqual(hashToken(token), tokenHash);
}

/** What the server stores for an issued OTP. The code itself is never stored. */
export interface OtpState {
  codeHash: string;
  /** Random per-code salt, hex. */
  salt: string;
  issuedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  /** Failed attempts so far. */
  attempts: number;
  /** Set once the code has been accepted; a used code is never accepted again. */
  usedAt?: IsoDateTime;
}

export interface IssuedOtp {
  /** Send this to the recipient; do not store it. */
  code: string;
  codeHash: string;
  expiresAt: IsoDateTime;
  state: OtpState;
}

export type OtpFailureCode = 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_LOCKED';

export type OtpCheck =
  | { ok: true; state: OtpState }
  | { ok: false; code: OtpFailureCode; attemptsLeft: number; state: OtpState; error: SignError };

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hashOtp(salt: string, code: string): string {
  return sha256Hex(`${salt}:${code}`);
}

/** Uniform random integer in [0, 10^digits) by rejection sampling, so no digit is favoured. */
function randomCode(random: RandomSource): string {
  const range = 10 ** OTP_DIGITS;
  const limit = Math.floor(0x100000000 / range) * range;
  for (;;) {
    const bytes = random.bytes(4);
    const value = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
    if (value < limit) return String(value % range).padStart(OTP_DIGITS, '0');
  }
}

export function createOtp(random: RandomSource, clock: Clock): IssuedOtp {
  const now = clock.now();
  const code = randomCode(random);
  const salt = hex(random.bytes(16));
  const state: OtpState = {
    codeHash: hashOtp(salt, code),
    salt,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
    attempts: 0,
  };
  return { code, codeHash: state.codeHash, expiresAt: state.expiresAt, state };
}

function failure(code: OtpFailureCode, state: OtpState): OtpCheck {
  const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - state.attempts);
  const messages: Record<OtpFailureCode, string> = {
    OTP_INVALID: `The code is not correct. ${attemptsLeft} attempt(s) left.`,
    OTP_EXPIRED: 'The code has expired. Ask for a new one.',
    OTP_LOCKED: 'Too many wrong attempts. Ask for a new code.',
  };
  return {
    ok: false,
    code,
    attemptsLeft,
    state,
    error: new SignError(code, messages[code], { attemptsLeft }),
  };
}

/**
 * Checks a code. Always persist the returned `state`: it carries the attempt count and
 * marks a correct code as used. Locked codes stay locked even if the right code arrives.
 */
export function verifyOtp(state: OtpState, code: string, clock: Clock): OtpCheck {
  if (state.attempts >= OTP_MAX_ATTEMPTS) return failure('OTP_LOCKED', state);
  const now = clock.now();
  if (now.getTime() >= Date.parse(state.expiresAt)) return failure('OTP_EXPIRED', state);
  if (state.usedAt) return failure('OTP_INVALID', state);

  const candidate = code.trim();
  const wellFormed = new RegExp(`^\\d{${OTP_DIGITS}}$`).test(candidate);
  const matches = constantTimeEqual(
    hashOtp(state.salt, wellFormed ? candidate : ''),
    state.codeHash,
  );
  if (wellFormed && matches) {
    return { ok: true, state: { ...state, usedAt: now.toISOString() } };
  }

  const next = { ...state, attempts: state.attempts + 1 };
  return failure(next.attempts >= OTP_MAX_ATTEMPTS ? 'OTP_LOCKED' : 'OTP_INVALID', next);
}
