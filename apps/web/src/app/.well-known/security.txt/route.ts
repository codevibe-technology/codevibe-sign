import { securityTxt } from '@/lib/security-txt';
import { env } from '@/server/env';
import { isHosted } from '@/server/plans';

export const dynamic = 'force-dynamic';

/** How to report a security problem in the hosted cloud. Self-hosted installs have none. */
export function GET() {
  if (!isHosted()) return new Response('Not found', { status: 404 });
  return new Response(securityTxt({ appUrl: env().APP_URL, now: new Date() }), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
