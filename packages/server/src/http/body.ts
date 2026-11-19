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

export function pdfResponse(c: Context, bytes: Uint8Array, name: string, suffix: string) {
  const base = name.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_') || 'document';
  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', `attachment; filename="${base}-${suffix}.pdf"`);
  c.header('Cache-Control', 'private, no-store');
  return c.body(new Uint8Array(bytes));
}
