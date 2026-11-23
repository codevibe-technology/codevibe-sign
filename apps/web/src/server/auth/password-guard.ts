import { passwordProblem } from '@/lib/password';
import type { PasswordLockout } from './password-lockout';

type Handler = (request: Request) => Promise<Response>;

const refuse = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ code, message }, { status, ...(headers ? { headers } : {}) });

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.clone().json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Wraps the auth handler with the two password rules the library does not have: sign-in
 * pauses for an address after too many wrong passwords, and a new password must pass
 * `passwordProblem` wherever one is set. Everything else goes straight through.
 */
export function guardPasswords(handler: Handler, lockout: PasswordLockout): Handler {
  return async (request) => {
    if (request.method !== 'POST') return handler(request);
    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    if (path.endsWith('/sign-in/email')) {
      const email = text((await jsonBody(request)).email);
      const minutes = email ? lockout.lockedFor(email) : 0;
      if (minutes > 0) {
        return refuse(
          429,
          'TOO_MANY_ATTEMPTS',
          `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or use "Email me a link instead".`,
          { 'retry-after': String(minutes * 60) },
        );
      }
      const response = await handler(request);
      if (email && response.status === 401) lockout.failed(email);
      else if (email && response.ok) lockout.clear(email);
      return response;
    }

    if (path.endsWith('/reset-password') || path.endsWith('/change-password')) {
      const problem = passwordProblem(text((await jsonBody(request)).newPassword));
      if (problem) return refuse(400, 'WEAK_PASSWORD', problem);
    }
    return handler(request);
  };
}
