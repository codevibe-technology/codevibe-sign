import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIES = ['cvs.session_token', '__Secure-cvs.session_token'];

/**
 * Sends visitors without a session cookie to sign-in before rendering an app page. Only a
 * convenience: every page and action checks the session itself.
 */
export function proxy(request: NextRequest) {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  const url = new URL('/sign-in', request.url);
  url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/dashboard', '/dashboard/:path*', '/onboarding'] };
