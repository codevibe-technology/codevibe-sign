/** The request header that carries a Turnstile token to `/api/auth/*`. */
export const HUMAN_CHECK_HEADER = 'x-turnstile-token';

/** The error code a refused human check answers with, from the auth routes and server actions. */
export const HUMAN_CHECK_CODE = 'HUMAN_CHECK';

/** Cloudflare's own limit on the length of a token. */
export const HUMAN_CHECK_TOKEN_MAX = 2048;

export type HumanCheckFailure = 'missing' | 'rejected' | 'unavailable';

/** What to tell the person when the check fails, each with the way out. */
export function humanCheckMessage(reason: HumanCheckFailure): string {
  switch (reason) {
    case 'missing':
      return 'The security check did not run in this browser. Reload the page and try again. If an ad or script blocker is on, allow challenges.cloudflare.com.';
    case 'rejected':
      return 'The security check expired or did not pass. Try again: a new check runs on its own.';
    case 'unavailable':
      return 'The security check is not answering right now. Wait a few seconds and try again.';
  }
}
