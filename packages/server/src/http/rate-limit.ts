import { SignError } from '@codevibe/sign-core';

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the next request would be allowed; 0 when allowed. */
  retryAfterMs: number;
}

/** Counts hits per key in fixed windows. Swap in a shared implementation (Redis, …) when running several processes. */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number, now: Date): Promise<RateLimitResult>;
}

interface Window {
  start: number;
  count: number;
  windowMs: number;
}

export function memoryRateLimiter(options: { maxKeys?: number } = {}): RateLimiter {
  const maxKeys = options.maxKeys ?? 100_000;
  const windows = new Map<string, Window>();

  function makeRoom(now: number) {
    for (const [key, window] of windows) {
      if (now - window.start >= window.windowMs) windows.delete(key);
    }
    const oldest = windows.keys().next();
    if (windows.size >= maxKeys && !oldest.done) windows.delete(oldest.value);
  }

  return {
    async hit(key, limit, windowMs, now) {
      const t = now.getTime();
      let window = windows.get(key);
      if (!window || t - window.start >= windowMs) {
        if (!window && windows.size >= maxKeys) makeRoom(t);
        window = { start: t, count: 0, windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      if (window.count <= limit) return { allowed: true, retryAfterMs: 0 };
      return { allowed: false, retryAfterMs: window.start + windowMs - t };
    },
  };
}

export async function enforce(
  limiter: RateLimiter,
  key: string,
  limit: number,
  windowMs: number,
  now: Date,
): Promise<void> {
  const result = await limiter.hit(key, limit, windowMs, now);
  if (!result.allowed) {
    throw new SignError('RATE_LIMITED', 'Too many requests, try again later', {
      retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
    });
  }
}
