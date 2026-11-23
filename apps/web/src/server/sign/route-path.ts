/**
 * The path of a request the way the sign server's router reads it: percent-escapes of
 * ordinary characters decoded first. Guards that look at the path must match on this, or
 * `/v1/envelopes/x/%76oid` would pass a check written for `/void` and still reach it.
 * Null when the escapes are malformed; such a request is refused.
 */
export function routedPath(url: string): string | null {
  const { pathname } = new URL(url);
  if (!pathname.includes('%')) return pathname;
  try {
    return decodeURI(pathname);
  } catch {
    return null;
  }
}

/** A path segment as the router hands it to a route, or null when it cannot be decoded. */
export function routedParam(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
