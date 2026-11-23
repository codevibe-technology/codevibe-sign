import { randomUUID } from 'node:crypto';
import { SignError } from '@codevibe_technology/sign-core';
import { readLimited, request, type FetchLike, type HttpOptions } from '../http';
import type {
  EsignEvent,
  EsignProvider,
  EsignRequest,
  EsignSession,
  EsignStatus,
  WebhookHeaders,
} from '../provider';
import {
  PROVIDER,
  envelopeError,
  readEnvelope,
  type CreateResponseData,
  type StatusRequest,
  type StatusResponseData,
} from './api';
import { checkHeader, peekDocumentId, verifyWebhook } from './webhook';

export const LEEGALITY_BASE_URLS = {
  sandbox: 'https://sandbox.leegality.com/api',
  production: 'https://app1.leegality.com/api',
} as const;

/** Leegality's documented limit for the PDF before base64 encoding. */
export const LEEGALITY_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const IRN_PATTERN = /^[A-Za-z0-9+|\-:(),_.[\]&/@]{1,255}$/;
const NAME_DISALLOWED = /[^A-Za-z0-9+|\-:(),_.[\]&/@]+/g;

export interface LeegalityOptions {
  /** Your account's Auth Token (Dashboard, API Settings). Sent as `X-Auth-Token`. */
  authToken: string;
  /** Your account's Private Salt (Dashboard, API Settings). Verifies webhook `mac` values. */
  privateSalt: string;
  /**
   * The Workflow ID to run. Leegality takes signature positions, the eSign type (Aadhaar),
   * the webhook URLs and the redirect URLs from the workflow, not from the API request, so
   * configure them there. Pass a function to choose a workflow per request, for example
   * by document layout.
   */
  profileId: string | ((request: EsignRequest) => string);
  environment: keyof typeof LEEGALITY_BASE_URLS;
  /** Overrides the base URL picked by `environment`. */
  baseUrl?: string;
  /** Per call, including reading the body. Default 30 000. */
  timeoutMs?: number;
  fetch?: FetchLike;
  /**
   * The webhook `mac` covers only the document id, so by default the reported status is
   * confirmed with the Check transaction status API before it is returned.
   */
  confirmWebhooks?: boolean;
  /** A static header Leegality support has configured on your webhooks, checked on every call. */
  webhookHeader?: { name: string; value: string };
  /** Largest signed PDF accepted from the provider. Default 50 MB. */
  maxSignedDocumentBytes?: number;
}

const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The auth token travels in a header, so it must never go over plain http to a remote host. */
function isSecureBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return (
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function required(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SignError('VALIDATION', `Leegality option ${name} is required`, { option: name });
  }
  return value;
}

function normalisePhone(phone: string): string {
  const compact = phone.replace(/[\s-]/g, '');
  const match = /^(?:\+?91)?(\d{10})$/.exec(compact);
  if (!match?.[1]) {
    throw new SignError('VALIDATION', 'Leegality needs a 10-digit Indian mobile number', {
      field: 'recipient.phone',
    });
  }
  return match[1];
}

function documentName(name: string): string {
  const cleaned = name.replace(NAME_DISALLOWED, '_').slice(0, 255);
  return cleaned === '' ? 'document' : cleaned;
}

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function confirms(status: EsignStatus, row: StatusRequest): boolean {
  switch (status) {
    case 'signed':
      return row.signed === true;
    case 'declined':
      return row.rejected === true;
    case 'expired':
    case 'failed':
      return row.expired === true;
  }
}

export function createLeegalityProvider(options: LeegalityOptions): EsignProvider {
  const authToken = required(options.authToken, 'authToken');
  const privateSalt = required(options.privateSalt, 'privateSalt');
  if (options.profileId === undefined || options.profileId === '') {
    throw new SignError('VALIDATION', 'Leegality option profileId is required', {
      option: 'profileId',
    });
  }
  const baseUrl = (options.baseUrl ?? LEEGALITY_BASE_URLS[options.environment])?.replace(
    /\/+$/,
    '',
  );
  if (!baseUrl) {
    throw new SignError(
      'VALIDATION',
      'Leegality option environment must be sandbox or production',
      {
        option: 'environment',
      },
    );
  }
  if (!isSecureBaseUrl(baseUrl)) {
    throw new SignError(
      'VALIDATION',
      'Leegality option baseUrl must be an https URL (http is allowed only for localhost)',
      { option: 'baseUrl' },
    );
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new SignError(
      'VALIDATION',
      `Leegality option timeoutMs must be a whole number from 1 to ${MAX_TIMEOUT_MS}`,
      { option: 'timeoutMs' },
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const http: HttpOptions = {
    fetch: fetchImpl,
    timeoutMs,
    provider: PROVIDER,
  };
  const confirmWebhooks = options.confirmWebhooks ?? true;
  const maxSignedBytes = options.maxSignedDocumentBytes ?? 50 * 1024 * 1024;
  const headers = { 'X-Auth-Token': authToken, Accept: 'application/json' };

  function resolveProfileId(input: EsignRequest): string {
    const id =
      typeof options.profileId === 'function' ? options.profileId(input) : options.profileId;
    return required(id, 'profileId');
  }

  async function transactionStatus(documentId: string): Promise<StatusResponseData> {
    const url = `${baseUrl}/v3.2/sign/request?documentId=${encodeURIComponent(documentId)}`;
    const envelope = await request(url, { method: 'GET', headers }, http, (res) =>
      readEnvelope<StatusResponseData>(res),
    );
    if (envelope.status !== 1 || !envelope.data) throw envelopeError(envelope);
    return envelope.data;
  }

  async function createRequest(input: EsignRequest): Promise<EsignSession> {
    const { recipient, documentBytes } = input;
    if (!recipient.name?.trim()) {
      throw new SignError('VALIDATION', 'Recipient name is required', { field: 'recipient.name' });
    }
    if (!recipient.email && !recipient.phone) {
      throw new SignError('VALIDATION', 'Leegality needs the recipient email or phone', {
        field: 'recipient.email',
      });
    }
    const reference = input.reference ?? input.envelopeId;
    if (!IRN_PATTERN.test(reference)) {
      throw new SignError(
        'VALIDATION',
        'The reference has characters Leegality does not accept',
        { field: input.reference === undefined ? 'envelopeId' : 'reference' },
      );
    }
    if (documentBytes.byteLength > LEEGALITY_MAX_UPLOAD_BYTES) {
      throw new SignError('DOCUMENT_TOO_LARGE', 'Leegality accepts PDFs up to 15 MB', {
        limit: LEEGALITY_MAX_UPLOAD_BYTES,
      });
    }
    if (!isPdf(documentBytes)) {
      throw new SignError('DOCUMENT_INVALID', 'The document is not a PDF');
    }

    const phone = recipient.phone ? normalisePhone(recipient.phone) : undefined;
    const invitee: Record<string, string> = { name: recipient.name.trim().slice(0, 255) };
    if (recipient.email) invitee.email = recipient.email;
    if (phone) invitee.phone = phone;

    const body = {
      profileId: resolveProfileId(input),
      file: {
        name: documentName(input.documentName),
        file: Buffer.from(documentBytes).toString('base64'),
      },
      invitees: [invitee],
      irn: reference,
    };

    const envelope = await request(
      `${baseUrl}/v3.0/sign/request`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      http,
      (res) => readEnvelope<CreateResponseData>(res),
    );

    // The published sample shows `status: 0` next to a success message, so a returned
    // documentId is taken as success too; failures always come with empty `data`.
    const data = envelope.data;
    if (!data?.documentId) throw envelopeError(envelope);

    const invitees = Array.isArray(data.invitees) ? data.invitees : [];
    const email = recipient.email?.toLowerCase();
    const match =
      invitees.find((i) => email !== undefined && i.email?.toLowerCase() === email) ??
      invitees.find((i) => phone !== undefined && i.phone?.slice(-10) === phone) ??
      (invitees.length === 1 ? invitees[0] : undefined);
    // The signer is sent to this URL, so anything but https (javascript:, data:, http:) is refused.
    if (!match?.signUrl || !isHttpsUrl(match.signUrl)) {
      throw new SignError('PROVIDER_ERROR', 'Leegality did not return a signing link', {
        provider: PROVIDER,
        reason: 'missing_sign_url',
        providerRef: data.documentId,
        retryable: false,
      });
    }
    return { providerRef: data.documentId, signUrl: match.signUrl };
  }

  async function parseWebhook(
    webhookHeaders: WebhookHeaders,
    rawBody: string | Uint8Array,
  ): Promise<EsignEvent | null> {
    if (options.webhookHeader) checkHeader(webhookHeaders, options.webhookHeader);
    const webhook = verifyWebhook(rawBody, privateSalt);
    if (webhook.status === null) return null;

    if (confirmWebhooks) {
      if (!webhook.invitationUrl) {
        throw new SignError('WEBHOOK_INVALID', 'Webhook does not name the invitation', {
          provider: PROVIDER,
        });
      }
      const status = await transactionStatus(webhook.documentId);
      const row = (status.requests ?? []).find((r) => r.signUrl === webhook.invitationUrl);
      if (!row || !confirms(webhook.status, row)) {
        throw new SignError('WEBHOOK_INVALID', 'Webhook does not match the document status', {
          provider: PROVIDER,
          providerRef: webhook.documentId,
        });
      }
    }

    const event: EsignEvent = { providerRef: webhook.documentId, status: webhook.status };
    if (webhook.signerName) event.signerName = webhook.signerName;
    return event;
  }

  async function fetchSignedDocument(providerRef: string): Promise<Uint8Array> {
    required(providerRef, 'providerRef');
    const status = await transactionStatus(providerRef);
    // Leegality documents `auditTrail` as present only once every required invitee has signed.
    if (!status.auditTrail) {
      throw new SignError('INVALID_STATE', 'The document is not signed by everyone yet', {
        provider: PROVIDER,
        providerRef,
      });
    }

    const url =
      `${baseUrl}/v3.1/document/fetchDocument?documentId=${encodeURIComponent(providerRef)}` +
      '&documentDownloadType=DOCUMENT';
    return request(
      url,
      { method: 'GET', headers: { 'X-Auth-Token': authToken } },
      http,
      async (res) => {
        const type = res.headers.get('content-type') ?? '';
        if (type.includes('json')) throw envelopeError(await readEnvelope(res));
        const bytes = await readLimited(res, maxSignedBytes);
        if (!bytes) {
          throw new SignError('DOCUMENT_TOO_LARGE', 'Signed document from Leegality is too large', {
            limit: maxSignedBytes,
          });
        }
        if (!isPdf(bytes)) {
          throw new SignError('DOCUMENT_INVALID', 'Leegality returned a file that is not a PDF', {
            provider: PROVIDER,
          });
        }
        return bytes;
      },
    );
  }

  /**
   * Asks for the status of a document id that cannot exist. Leegality answers "no document
   * found" to an account it recognises and refuses one it does not.
   */
  async function checkCredentials(): Promise<void> {
    try {
      await transactionStatus(`check-${randomUUID()}`);
    } catch (error) {
      if (error instanceof SignError && error.details?.reason === 'not_found') return;
      throw error;
    }
    throw new SignError('PROVIDER_ERROR', 'Leegality returned an unexpected response', {
      provider: PROVIDER,
      reason: 'malformed_response',
      retryable: false,
    });
  }

  return {
    name: 'leegality',
    createRequest,
    parseWebhook,
    fetchSignedDocument,
    webhookRef: peekDocumentId,
    checkCredentials,
  };
}
