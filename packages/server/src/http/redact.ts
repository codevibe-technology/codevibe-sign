import type { Logger } from '../errors';

/** Meta keys whose values are secrets or personal content and never belong in a log. */
const SECRET_KEYS =
  /^(authorization|cookie|set-cookie|token|sessiontoken|session|otp|code|password|passphrase|secret|apikey|key|body|value|values|signature)$/i;

/** A signing token: 43 base64url characters standing on their own. */
const TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const SIGN_SEGMENT = /(\/sign\/)[^/?#\s]+/g;
const BEARER = /(Bearer\s+)\S+/gi;

/** The path without its query string and with the signing token segment replaced. */
export function redactPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(SIGN_SEGMENT, '$1:token');
}

export function redactText(text: string): string {
  return text
    .replace(SIGN_SEGMENT, '$1:token')
    .replace(BEARER, '$1[redacted]')
    .replace(TOKEN, '[token]');
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactText(value);
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? '[redacted]' : redactValue(item, depth + 1),
    ]),
  );
}

export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return redactValue(meta, 0) as Record<string, unknown>;
}

/**
 * Wraps a logger so nothing it receives can carry a signing token, an OTP or session value,
 * credentials or request bodies, whatever the caller passes.
 */
export function redactingLogger(logger: Logger): Logger {
  const wrap =
    (write: (message: string, meta?: Record<string, unknown>) => void) =>
    (message: string, meta?: Record<string, unknown>) =>
      meta === undefined
        ? write(redactText(message))
        : write(redactText(message), redactMeta(meta));
  return {
    error: wrap(logger.error.bind(logger)),
    warn: wrap(logger.warn.bind(logger)),
    ...(logger.info ? { info: wrap(logger.info.bind(logger)) } : {}),
  };
}
