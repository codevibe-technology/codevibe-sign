import type { Context } from 'hono';
import { validation } from '../errors';

export async function readJson(c: Context, optional = false): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '' && optional) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validation('Request body must be valid JSON');
  }
}

/** Characters that cannot go in a file name on common systems, or that would break the header. */
const UNSAFE_NAME = /[\u0000-\u001f\u007f"*/:<>?\\|]+/g;

/**
 * `Content-Disposition` for a download. `filename` is a plain ASCII fallback for old clients;
 * `filename*` (RFC 6266) carries the real name, so names in other scripts survive.
 */
export function attachmentDisposition(name: string, suffix: string): string {
  const base = name.replace(/\.pdf$/i, '').trim();
  const ascii = base.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'document';
  const full = base.replace(UNSAFE_NAME, '_').trim() || 'document';
  const encoded = encodeURIComponent(`${full}-${suffix}.pdf`).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}-${suffix}.pdf"; filename*=UTF-8''${encoded}`;
}

export function pdfResponse(c: Context, bytes: Uint8Array, name: string, suffix: string) {
  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', attachmentDisposition(name, suffix));
  c.header('Cache-Control', 'private, no-store');
  return c.body(new Uint8Array(bytes));
}
