import { HUMAN_CHECK_CODE, HUMAN_CHECK_HEADER, humanCheckMessage } from '@/lib/human-check';
import type { HumanCheck } from '../human-check';

type Handler = (request: Request) => Promise<Response>;
type Check = (token: string | null, request: Request) => Promise<HumanCheck>;

/**
 * The auth routes anyone can call that sign someone in, or send an email or create an account
 * for an address the caller types in. Matched on the path after `/api/auth`.
 */
export const HUMAN_CHECKED_PATHS = [
  '/sign-in/email',
  '/sign-in/magic-link',
  '/sign-up/email',
  '/request-password-reset',
  '/forget-password',
  '/send-verification-email',
];

const guarded = (pathname: string) => {
  const path = pathname
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .replace(/^.*\/api\/auth/, '');
  return HUMAN_CHECKED_PATHS.includes(path);
};

/**
 * Wraps the auth handler so the routes above need a passed human check. `check` decides,
 * and lets everything through when the check is off for the install.
 */
export function guardHumans(handler: Handler, check: Check): Handler {
  return async (request) => {
    if (request.method !== 'POST' || !guarded(new URL(request.url).pathname)) {
      return handler(request);
    }
    const result = await check(request.headers.get(HUMAN_CHECK_HEADER), request);
    if (result.ok) return handler(request);
    return Response.json(
      { code: HUMAN_CHECK_CODE, message: humanCheckMessage(result.reason) },
      {
        status: result.reason === 'unavailable' ? 503 : 403,
        headers: { 'cache-control': 'no-store' },
      },
    );
  };
}
