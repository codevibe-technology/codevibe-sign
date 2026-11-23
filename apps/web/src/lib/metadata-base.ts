/**
 * The base for absolute URLs in page metadata (OpenGraph images, canonical links): the app's
 * public URL. Undefined when it is missing or not a URL, so metadata never points at
 * localhost on a real install; `env()` reports the bad value on the first request.
 */
export function metadataBase(appUrl: string | undefined): URL | undefined {
  if (!appUrl) return undefined;
  try {
    const url = new URL(appUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}
