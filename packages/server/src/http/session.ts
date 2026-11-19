import { constantTimeEqual, hmacSha256Hex } from '../crypto';

export const SESSION_COOKIE = 'cvsign_session';
export const SESSION_HEADER = 'x-sign-session';
export const SESSION_TTL_MS = 30 * 60 * 1000;

interface SessionClaims {
  /** Hash of the signing token the session belongs to. */
  t: string;
  exp: number;
}

/** A short-lived proof that the holder of a signing token passed its OTP check. */
export function issueSession(
  secret: string,
  tokenHash: string,
  now: Date,
): {
  value: string;
  expiresAt: Date;
} {
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const claims: SessionClaims = { t: tokenHash, exp: expiresAt.getTime() };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { value: `${payload}.${hmacSha256Hex(secret, payload)}`, expiresAt };
}

export function verifySession(
  secret: string,
  value: string | undefined,
  tokenHash: string,
  now: Date,
): boolean {
  if (!value) return false;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  if (!constantTimeEqual(signature, hmacSha256Hex(secret, payload))) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    return claims.t === tokenHash && typeof claims.exp === 'number' && claims.exp > now.getTime();
  } catch {
    return false;
  }
}
