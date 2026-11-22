import { memoryRateLimiter } from '@codevibe_technology/sign-server';

/** Sign-in links one address can be sent in a window. */
export const MAGIC_LINKS_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;

export class TooManySignInLinks extends Error {
  constructor(minutes: number) {
    super(
      `We already sent several sign-in links to this address. Use the latest one, or try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    );
    this.name = 'TooManySignInLinks';
  }
}

type Send = (email: string, url: string) => Promise<void>;

/**
 * Caps the sign-in links sent to one address, so the form cannot be used to flood someone's
 * inbox from this install. The request limit by IP does not cover that: the requests can come
 * from many addresses.
 */
export function limitMagicLinks(send: Send, now: () => Date = () => new Date()): Send {
  const limiter = memoryRateLimiter({ maxKeys: 50_000 });
  return async (email, url) => {
    const key = `magic:${email.trim().toLowerCase()}`;
    const result = await limiter.hit(key, MAGIC_LINKS_PER_WINDOW, WINDOW_MS, now());
    if (!result.allowed) throw new TooManySignInLinks(Math.ceil(result.retryAfterMs / 60_000));
    await send(email, url);
  };
}
