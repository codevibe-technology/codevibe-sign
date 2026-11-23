import 'server-only';
import { env } from './env';

/**
 * The visitor's address as the proxy in front of the app reports it, or null when the app is
 * not told to trust one. Only ever used as a rate limit key.
 */
export function clientAddress(headers: Headers): string | null {
  if (!env().TRUST_PROXY) return null;
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? null;
}
