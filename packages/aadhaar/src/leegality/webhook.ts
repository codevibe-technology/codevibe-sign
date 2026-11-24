import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignError } from '@codevibe_technology/sign-core';
import type { EsignStatus, WebhookHeaders } from '../provider';
import { PROVIDER, isRecord } from './api';
import { v4Ref } from './v4';

export interface LeegalityWebhook {
  documentId: string;
  /** Set for a Webhook 4.0 body, which belongs to a v4 pack. */
  packId?: string;
  status: EsignStatus | null;
  signerName?: string;
  invitationUrl?: string;
}

/** Leegality callbacks are small JSON documents; anything larger is refused before parsing. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

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

/**
 * Webhook 4.0 events of a signer
 * (https://knowledge.leegality.com/document-execution/api/webhooks-v4/webhook-v4-event-types).
 * `SIGNED` also arrives when a certificate check failed but the workflow accepts the
 * signature; reviewer events change nothing here.
 */
const V4_EVENTS: Record<string, EsignStatus> = {
  SIGNED: 'signed',
  SIGNER_REJECTION: 'declined',
  VERIFICATION_FAILED: 'failed',
  AADHAAR_RETRY_EXHAUSTED: 'failed',
  INVITATION_TIMEOUT: 'expired',
};

/** A Webhook 4.0 body nests the document; every key is present, `null` when it does not apply. */
function isV4(body: Record<string, unknown>): boolean {
  return typeof body.eventType === 'string' && isRecord(body.document);
}

function verifyMac(documentId: unknown, mac: unknown, privateSalt: string): string {
  if (typeof documentId !== 'string' || documentId === '') {
    throw invalid('Webhook has no documentId');
  }
  if (typeof mac !== 'string' || mac === '') throw invalid('Webhook has no mac');
  if (!safeEqual(mac.toLowerCase(), computeMac(documentId, privateSalt))) {
    throw invalid('Webhook mac does not match');
  }
  return documentId;
}

function verifyV4(body: Record<string, unknown>, privateSalt: string): LeegalityWebhook {
  const document = body.document as Record<string, unknown>;
  // The mac signs `document.documentId` only (webhook-signed, `mac`); the pack id is checked
  // against the status API before anything is acted on.
  const documentId = verifyMac(document.documentId, body.mac, privateSalt);
  const pack = isRecord(body.pack) ? body.pack : {};
  if (typeof pack.packId !== 'string' || pack.packId === '') {
    throw invalid('Webhook has no packId');
  }
  const invitee = isRecord(body.invitee) ? body.invitee : {};
  const result: LeegalityWebhook = {
    documentId,
    packId: pack.packId,
    status: V4_EVENTS[body.eventType as string] ?? null,
  };
  if (typeof invitee.inviteeName === 'string' && invitee.inviteeName !== '') {
    result.signerName = invitee.inviteeName;
  }
  return result;
}

function parseBody(rawBody: string | Uint8Array): Record<string, unknown> {
  const size =
    typeof rawBody === 'string' ? Buffer.byteLength(rawBody, 'utf8') : rawBody.byteLength;
  if (size > MAX_WEBHOOK_BYTES) throw invalid('Webhook body is too large');
  const text = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw invalid('Webhook body is not JSON');
  }
  if (!isRecord(body)) throw invalid('Webhook body is not an object');
  return body;
}

/**
 * Parses and verifies a Leegality webhook body, version 2.5 (v3.0 documents) or 4.0 (v4
 * packs). Throws `WEBHOOK_INVALID` unless the mac matches.
 */
export function verifyWebhook(rawBody: string | Uint8Array, privateSalt: string): LeegalityWebhook {
  const body = parseBody(rawBody);
  if (isV4(body)) return verifyV4(body, privateSalt);
  const documentId = verifyMac(body.documentId, body.mac, privateSalt);

  const request = isRecord(body.request) ? body.request : {};
  const result: LeegalityWebhook = { documentId, status: statusOf(body, request) };
  if (typeof request.name === 'string' && request.name !== '') result.signerName = request.name;
  if (typeof request.invitationUrl === 'string') result.invitationUrl = request.invitationUrl;
  return result;
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * The provider reference a webhook body names, without checking its mac: the document id of
 * a v3.0 document, or `v4:<packId>:<documentId>` of a v4 pack.
 */
export function peekDocumentId(rawBody: string | Uint8Array): string | null {
  let body: Record<string, unknown>;
  try {
    body = parseBody(rawBody);
  } catch {
    return null;
  }
  if (isV4(body)) {
    const documentId = (body.document as Record<string, unknown>).documentId;
    const packId = isRecord(body.pack) ? body.pack.packId : undefined;
    return nonEmpty(packId) && nonEmpty(documentId) ? v4Ref(packId, documentId) : null;
  }
  return nonEmpty(body.documentId) ? body.documentId : null;
}
