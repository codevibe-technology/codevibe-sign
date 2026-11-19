import { concat, encoder, toHex } from './bytes';
import { SignApiError } from './errors';
import type { WebhookDelivery } from './types';

export const SIGNATURE_HEADER = 'x-codevibe-signature';

/** A header value as frameworks hand it over; Node gives `string[]` for repeated headers. */
export type SignatureHeader = string | string[] | null | undefined;

export interface VerifyWebhookOptions {
  /** Oldest signature to accept, in seconds. Default 300. */
  toleranceSeconds?: number;
  now?: Date;
}

/**
 * Checks the `x-codevibe-signature` header (`t=<unix seconds>,v1=<hex HMAC-SHA256 of
 * "<t>.<body>">`) against the raw request body. Pass the body exactly as received: parsing
 * and re-serialising the JSON changes the bytes and the check fails.
 */
export async function verifyWebhook(
  secret: string,
  signatureHeader: SignatureHeader,
  rawBody: string | Uint8Array,
  options: VerifyWebhookOptions = {},
): Promise<boolean> {
  const parsed = parseHeader(signatureHeader);
  if (!parsed) return false;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - parsed.t) > (options.toleranceSeconds ?? 300)) return false;
  const expected = await hmacHex(secret, concat(encoder.encode(`${parsed.t}.`), bytesOf(rawBody)));
  return parsed.v1.some((candidate) => constantTimeEqual(candidate, expected));
}

/**
 * Verifies the delivery and returns its parsed body. Throws `SignApiError` with code
 * `WEBHOOK_INVALID` when the signature is missing, wrong or too old.
 */
export async function readWebhook(
  secret: string,
  signatureHeader: SignatureHeader,
  rawBody: string | Uint8Array,
  options: VerifyWebhookOptions = {},
): Promise<WebhookDelivery> {
  if (!(await verifyWebhook(secret, signatureHeader, rawBody, options))) {
    throw new SignApiError('WEBHOOK_INVALID', 'Webhook signature is missing, wrong or too old');
  }
  const text = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
  return JSON.parse(text) as WebhookDelivery;
}

function parseHeader(header: SignatureHeader): { t: number; v1: string[] } | null {
  if (Array.isArray(header)) header = header.join(',');
  if (!header) return null;
  let t = Number.NaN;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't') t = Number(value);
    else if (key === 'v1' && value) v1.push(value.toLowerCase());
  }
  return Number.isInteger(t) && v1.length > 0 ? { t, v1 } : null;
}

async function hmacHex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, data)));
}

function bytesOf(body: string | Uint8Array): Uint8Array {
  return typeof body === 'string' ? encoder.encode(body) : body;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
