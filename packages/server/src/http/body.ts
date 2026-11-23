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
const UNSAFE_NAME = /[\p{Cc}"*/:<>?\\|]+/gu;

/**
 * `Content-Disposition` for a download. `filename` is a plain ASCII fallback for old clients;
 * `filename*` (RFC 6266) carries the real name, so names in other scripts survive.
 */
export function attachmentDisposition(name: string, suffix: string): string {
  const base = name.replace(/\.pdf$/i, '').trim();
  const ascii = base.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'document';
  const full = base.replace(UNSAFE_NAME, '_').trim() || 'document';
  return disposition(`${ascii}-${suffix}.pdf`, `${full}-${suffix}.pdf`);
}

/** `Content-Disposition` for a download saved under exactly `filename`, such as "Offer (audit trail).pdf". */
export function namedDisposition(filename: string): string {
  const full = filename.replace(UNSAFE_NAME, '_').trim() || 'document.pdf';
  const ascii =
    full
      .replace(/\.pdf$/i, '')
      .replace(/[^\w.() -]+/g, '_')
      .trim() || 'document';
  return disposition(`${ascii}.pdf`, full);
}

function disposition(ascii: string, full: string): string {
  const encoded = encodeURIComponent(full).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * A PDF download named `<name>-<suffix>.pdf`, or exactly `{ filename }` when `suffix` is one,
 * as for the certificate and audit trail of an Aadhaar eSign.
 */
export function pdfResponse(
  c: Context,
  bytes: Uint8Array,
  name: string,
  suffix: string | { filename: string },
) {
  c.header('Content-Type', 'application/pdf');
  c.header(
    'Content-Disposition',
    typeof suffix === 'string'
      ? attachmentDisposition(name, suffix)
      : namedDisposition(suffix.filename),
  );
  c.header('Cache-Control', 'private, no-store');
  return c.body(new Uint8Array(bytes));
}
