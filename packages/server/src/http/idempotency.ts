import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { sha256Hex } from '../crypto';
import { HttpError } from '../errors';
import type { ServerStore } from '../store/types';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Replays the stored response when a POST is retried with the same `Idempotency-Key`.
 * `scope` keeps keys from different callers apart. Server errors are not stored, so the
 * caller can retry them.
 */
export function idempotency(
  store: ServerStore,
  scope: (c: Parameters<MiddlewareHandler>[0]) => string,
  now: () => Date,
): MiddlewareHandler {
  return async (c, next) => {
    const key = c.req.header('idempotency-key');
    if (c.req.method !== 'POST' || key === undefined) return next();
    if (key.length === 0 || key.length > 255) {
      throw new HttpError('VALIDATION', 'Idempotency-Key must be 1 to 255 characters');
    }
    const body = new Uint8Array(await c.req.arrayBuffer());
    const fingerprint = sha256Hex(
      Buffer.concat([Buffer.from(`${c.req.method} ${c.req.path}\n`), body]),
    );
    const owner = scope(c);
    const claim = await store.claimIdempotency(owner, key, fingerprint, now());
    if (claim.state === 'mismatch') {
      throw new HttpError('VALIDATION', 'This Idempotency-Key was used for a different request');
    }
    if (claim.state === 'in_progress') {
      throw new HttpError('CONFLICT', 'A request with this Idempotency-Key is still running');
    }
    if (claim.state === 'replay') {
      c.header('Idempotent-Replayed', 'true');
      return c.json(claim.body as object, claim.status as ContentfulStatusCode);
    }

    try {
      await next();
    } catch (err) {
      await store.releaseIdempotency(owner, key);
      throw err;
    }
    if (c.res.status >= 500) {
      await store.releaseIdempotency(owner, key);
      return;
    }
    const stored = await c.res
      .clone()
      .json()
      .catch(() => null);
    await store.completeIdempotency(owner, key, c.res.status, stored);
  };
}
