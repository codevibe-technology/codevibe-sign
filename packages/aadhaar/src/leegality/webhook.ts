import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignError } from '@codevibe/sign-core';
import type { EsignStatus, WebhookHeaders } from '../provider';
import { PROVIDER, isRecord } from './api';

export interface LeegalityWebhook {
  documentId: string;
  status: EsignStatus | null;
  signerName?: string;
  invitationUrl?: string;
}

function invalid(message: string): SignError {
  return new SignError('WEBHOOK_INVALID', message, { provider: PROVIDER });
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Leegality signs only the document id: `mac = hex(HMAC-SHA1(key = privateSalt, documentId))`. */
export function computeMac(documentId: string, privateSalt: string): string {
  return createHmac('sha1', privateSalt).update(documentId, 'utf8').digest('hex');
}

export function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return undefined;
}

export function checkHeader(
  headers: WebhookHeaders,
  expected: { name: string; value: string },
): void {
  const actual = headerValue(headers, expected.name);
  if (actual === undefined || !safeEqual(actual, expected.value)) {
    throw invalid(`Webhook is missing the expected ${expected.name} header`);
  }
}

function statusOf(
  body: Record<string, unknown>,
  request: Record<string, unknown>,
): EsignStatus | null {
  if (request.action === 'Signed') return 'signed';
  if (request.action === 'Rejected') return 'declined';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const verificationFailed = messages.some(
    (m) => isRecord(m) && typeof m.code === 'string' && m.code.endsWith('.verification.failed'),
  );
  if (verificationFailed) return 'failed';
  if (request.expired === true) return 'expired';
  if (body.webhookType === 'Error') return 'failed';
  return null;
}

/** Parses and verifies a Leegality webhook body. Throws `WEBHOOK_INVALID` unless the mac matches. */
export function verifyWebhook(rawBody: string | Uint8Array, privateSalt: string): LeegalityWebhook {
  const text = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw invalid('Webhook body is not JSON');
  }
  if (!isRecord(body)) throw invalid('Webhook body is not an object');
  const { documentId, mac } = body;
  if (typeof documentId !== 'string' || documentId === '') {
    throw invalid('Webhook has no documentId');
  }
  if (typeof mac !== 'string' || mac === '') throw invalid('Webhook has no mac');
  if (!safeEqual(mac.toLowerCase(), computeMac(documentId, privateSalt))) {
    throw invalid('Webhook mac does not match');
  }

  const request = isRecord(body.request) ? body.request : {};
  const result: LeegalityWebhook = { documentId, status: statusOf(body, request) };
  if (typeof request.name === 'string' && request.name !== '') result.signerName = request.name;
  if (typeof request.invitationUrl === 'string') result.invitationUrl = request.invitationUrl;
  return result;
}
