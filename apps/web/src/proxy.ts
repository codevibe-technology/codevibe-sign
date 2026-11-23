import { NextResponse, type NextRequest } from 'next/server';
import { PATH_HEADER } from '@/lib/request-path';

const SESSION_COOKIES = ['cvs.session_token', '__Secure-cvs.session_token'];

/**
 * Sends visitors without a session cookie to sign-in before rendering an app page. Only a
 * convenience: every page and action checks the session itself. For everyone else it passes
 * the path on, so a page opened at an old workspace address can redirect to the same page.
 */
export function proxy(request: NextRequest) {
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    const forwarded = new Headers(request.headers);
    forwarded.set(PATH_HEADER, next);
    return NextResponse.next({ request: { headers: forwarded } });
  }
  const url = new URL('/sign-in', request.url);
  url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/dashboard', '/dashboard/:path*', '/onboarding'] };
