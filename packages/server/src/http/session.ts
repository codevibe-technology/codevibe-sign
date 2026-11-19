import { constantTimeEqual, hmacSha256Hex } from '../crypto';

export const SESSION_COOKIE = 'cvsign_session';
export const SESSION_HEADER = 'x-sign-session';
export const SESSION_TTL_MS = 30 * 60 * 1000;
/** Holds the signing token after the link is opened, so later URLs do not carry it. */
export const LINK_COOKIE = 'cvsign_link';
/** Path segment that stands for "the token in the link cookie" in `/v1/sign/<token>/...`. */
export const LINK_SEGMENT = 'link';
/** Longest a link cookie lives, however long the token itself is valid. */
export const LINK_COOKIE_MAX_MS = 24 * 60 * 60 * 1000;

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

/** Proof that a recipient finished signing, kept so they can fetch the sealed copy later. */
export const RECEIPT_COOKIE = 'cvsign_receipt';
export const RECEIPT_HEADER = 'x-sign-receipt';
export const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ReceiptClaims {
  k: 'receipt';
  e: string;
  r: string;
  exp: number;
}

export function issueReceipt(
  secret: string,
  envelopeId: string,
  recipientId: string,
  now: Date,
): { value: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + RECEIPT_TTL_MS);
  const claims: ReceiptClaims = {
    k: 'receipt',
    e: envelopeId,
    r: recipientId,
    exp: expiresAt.getTime(),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { value: `${payload}.${hmacSha256Hex(secret, payload)}`, expiresAt };
}

/** The envelope and recipient a receipt names, or null when it is forged, malformed or old. */
export function verifyReceipt(
  secret: string,
  value: string | undefined,
  now: Date,
): { envelopeId: string; recipientId: string } | null {
  if (!value || value.length > 1024) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  if (!constantTimeEqual(signature, hmacSha256Hex(secret, payload))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ReceiptClaims;
    if (claims.k !== 'receipt' || typeof claims.e !== 'string' || typeof claims.r !== 'string') {
      return null;
    }
    if (typeof claims.exp !== 'number' || claims.exp <= now.getTime()) return null;
    return { envelopeId: claims.e, recipientId: claims.r };
  } catch {
    return null;
  }
}
