import type { Context } from 'hono';

interface NodeIncoming {
  incoming?: { socket?: { remoteAddress?: string } };
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  const env = c.env as NodeIncoming | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export function userAgent(c: Context): string | undefined {
  return c.req.header('user-agent')?.slice(0, 512);
}
