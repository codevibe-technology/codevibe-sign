import { isIP } from 'node:net';
import type { Context } from 'hono';

interface NodeIncoming {
  incoming?: { socket?: { remoteAddress?: string } };
}

export interface ProxyTrust {
  /** Read the client IP from `X-Forwarded-For`. */
  trustProxy: boolean;
  /** Proxies in front of the server that append to `X-Forwarded-For`. */
  trustedProxyHops: number;
}

/**
 * The client IP. Behind trusted proxies it is the `X-Forwarded-For` entry added by the
 * outermost trusted proxy: counting from the right, past `trustedProxyHops - 1` proxy
 * entries. Entries further left were written by the client and can be anything.
 */
export function clientIp(c: Context, proxy: ProxyTrust): string {
  const env = c.env as NodeIncoming | undefined;
  const socket = env?.incoming?.socket?.remoteAddress ?? 'unknown';
  if (!proxy.trustProxy) return socket;
  const entries = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) return socket;
  const candidate = entries[Math.max(0, entries.length - proxy.trustedProxyHops)] ?? '';
  return isIP(candidate) ? candidate : socket;
}

export function userAgent(c: Context): string | undefined {
  return c.req.header('user-agent')?.slice(0, 512);
}
