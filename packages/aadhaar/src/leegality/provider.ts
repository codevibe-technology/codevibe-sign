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
  MAX_JSON_RESPONSE_BYTES,
  PROVIDER,
  envelopeError,
  isRecord,
  readEnvelope,
  type CreateResponseData,
  type StatusRequest,
  type StatusResponseData,
} from './api';
import {
  DEFAULT_COORDINATE_MAPPING,
  parseCoordinateOrigin,
  type CoordinateMapping,
} from './coordinates';
import {
  checkV4Workflow,
  packRequest,
  parseV4Ref,
  v4Error,
  v4Ref,
  type LeegalityV4Workflow,
  type PackCreated,
  type PackDetails,
} from './v4';
import { v21Request } from './v21';
import { checkHeader, peekDocumentId, verifyWebhook, type LeegalityWebhook } from './webhook';

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
   * configure them there. The v3.0 API has no field for `signaturePositions`; see `v4` for
   * requests that carry them. Pass a function to choose a workflow per request, for example
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
  /**
   * A v4 workflow, for `positionApi: 'v4'`: a request with `signaturePositions` is then sent
   * with the v4 Pack API.
   */
  v4?: LeegalityV4Workflow;
  /**
   * Which API places a request's `signaturePositions`. `v2.1` (the default without `v4`)
   * sends the request to the 2.1 Create API with the positions as the invitee's
   * `appearances`, using the same Auth Token; `v4` (the default with `v4`) uses the v4 Pack
   * API; `off` ignores positions. Requests without positions always use `profileId` and v3.0.
   */
  positionApi?: 'v2.1' | 'v4' | 'off';
  /** How positions become Leegality coordinates. Default points, bottom-left origin. */
  coordinates?: CoordinateMapping;
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
      return row.expired === true;
    case 'failed':
      // A failed identity check leaves the invitation open at the provider, so the status
      // API can only show that nothing was signed or rejected.
      return row.signed !== true && row.rejected !== true;
  }
}

/**
 * `invitationStatus.status` of Check Pack Details. A failed verification or exhausted Aadhaar
 * retries leave the invitation `EXPIRED`
 * (https://knowledge.leegality.com/document-execution/api/webhook-verification-failed).
 */
function confirmsV4(status: EsignStatus, invitation: string): boolean {
  switch (status) {
    case 'signed':
      return invitation === 'SIGNED';
    case 'declined':
      return invitation === 'SIGNER_REJECTED';
    case 'expired':
      return invitation === 'EXPIRED';
    case 'failed':
      return invitation !== 'SIGNED' && invitation !== 'SIGNER_REJECTED';
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
  const v4 = options.v4 ? checkV4Workflow(options.v4) : undefined;
  const positionApi = options.positionApi ?? (v4 ? 'v4' : 'v2.1');
  if (!['v2.1', 'v4', 'off'].includes(positionApi)) {
    throw new SignError('VALIDATION', 'Leegality option positionApi must be v2.1, v4 or off', {
      option: 'positionApi',
    });
  }
  if (positionApi === 'v4' && !v4) {
    throw new SignError('VALIDATION', 'Leegality option positionApi v4 needs the v4 workflow', {
      option: 'v4',
    });
  }
  const mapping = options.coordinates ?? DEFAULT_COORDINATE_MAPPING;
  parseCoordinateOrigin(mapping.origin);
  if (
    mapping.units !== 'points' &&
    !(Number.isInteger(mapping.units?.pixelsPerInch) && mapping.units.pixelsPerInch > 0)
  ) {
    throw new SignError('VALIDATION', 'Leegality option coordinates.units is not valid', {
      option: 'coordinates.units',
    });
  }

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

  /** Reads a v4 JSON response, which is not wrapped like the v3 ones. */
  async function readJson<T>(res: Response): Promise<T> {
    const bytes = await readLimited(res, MAX_JSON_RESPONSE_BYTES);
    let body: unknown;
    try {
      body = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    } catch {
      body = undefined;
    }
    if (!isRecord(body)) {
      throw new SignError('PROVIDER_ERROR', `${PROVIDER} returned an unexpected response`, {
        provider: PROVIDER,
        reason: 'malformed_response',
        retryable: false,
      });
    }
    return body as T;
  }

  const explainV4 = async (res: Response) =>
    v4Error(await readJson<unknown>(res), `${PROVIDER} rejected the request`);

  /** `GET /api/v4/packs` (https://knowledge.leegality.com/document-execution/api/check-pack-details). */
  async function packDetails(packId: string): Promise<NonNullable<PackDetails['data']>> {
    const url = `${baseUrl}/v4/packs?packId=${encodeURIComponent(packId)}`;
    const body = await request(
      url,
      { method: 'GET', headers },
      http,
      (res) => readJson<PackDetails>(res),
      explainV4,
    );
    if (!isRecord(body.data)) throw v4Error(body, `${PROVIDER} returned no pack details`);
    return body.data;
  }

  interface Prepared {
    reference: string;
    name: string;
    email?: string;
    phone?: string;
  }

  function prepare(input: EsignRequest): Prepared {
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
      throw new SignError('VALIDATION', 'The reference has characters Leegality does not accept', {
        field: input.reference === undefined ? 'envelopeId' : 'reference',
      });
    }
    if (documentBytes.byteLength > LEEGALITY_MAX_UPLOAD_BYTES) {
      throw new SignError('DOCUMENT_TOO_LARGE', 'Leegality accepts PDFs up to 15 MB', {
        limit: LEEGALITY_MAX_UPLOAD_BYTES,
      });
    }
    if (!isPdf(documentBytes)) {
      throw new SignError('DOCUMENT_INVALID', 'The document is not a PDF');
    }
    const prepared: Prepared = { reference, name: recipient.name.trim().slice(0, 255) };
    if (recipient.email) prepared.email = recipient.email;
    if (recipient.phone) prepared.phone = normalisePhone(recipient.phone);
    return prepared;
  }

  const missingSignUrl = (providerRef: string) =>
    new SignError('PROVIDER_ERROR', 'Leegality did not return a signing link', {
      provider: PROVIDER,
      reason: 'missing_sign_url',
      providerRef,
      retryable: false,
    });

  /**
   * Creates a request with the v3.0 or the 2.1 Create API. Both answer in the same wrapper
   * with the document id and each invitee's sign URL, and the document is then followed with
   * the same status, download and webhook calls.
   */
  async function createLegacy(
    path: string,
    body: Record<string, unknown>,
    prepared: Prepared,
  ): Promise<EsignSession> {
    const { email, phone } = prepared;
    const envelope = await request(
      `${baseUrl}${path}`,
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

    const listed = Array.isArray(data.invitees) ? data.invitees : data.invitations;
    const invitees = Array.isArray(listed) ? listed : [];
    const lower = email?.toLowerCase();
    const match =
      invitees.find((i) => lower !== undefined && i.email?.toLowerCase() === lower) ??
      invitees.find((i) => phone !== undefined && i.phone?.slice(-10) === phone) ??
      (invitees.length === 1 ? invitees[0] : undefined);
    // The signer is sent to this URL, so anything but https (javascript:, data:, http:) is refused.
    if (!match?.signUrl || !isHttpsUrl(match.signUrl)) throw missingSignUrl(data.documentId);
    return { providerRef: data.documentId, signUrl: match.signUrl };
  }

  function createV3(input: EsignRequest, prepared: Prepared): Promise<EsignSession> {
    const invitee: Record<string, string> = { name: prepared.name };
    if (prepared.email) invitee.email = prepared.email;
    if (prepared.phone) invitee.phone = prepared.phone;
    // Positions are not sent: the v3.0 Create request has no field for them
    // (https://knowledge.leegality.com/document-execution/api/create-an-e-signing-request).
    // Leegality places the appearance where the workflow says, or at the bottom left of every
    // page when the workflow has no coordinates
    // (https://knowledge.leegality.com/document-execution/leegality-features/signature-coordinate).
    return createLegacy(
      '/v3.0/sign/request',
      {
        profileId: resolveProfileId(input),
        file: {
          name: documentName(input.documentName),
          file: Buffer.from(input.documentBytes).toString('base64'),
        },
        invitees: [invitee],
        irn: prepared.reference,
      },
      prepared,
    );
  }

  /**
   * The 2.1 Create API, `POST /api/v2.1/sign/request` with the `X-Auth-Token` header (v2.1
   * OpenAPI schema `SignRequest`, https://github.com/prakharmittal/leegality-apidocs/blob/master/api_2_1.json).
   * Its document is an ordinary Leegality document, followed with the v3.x status and
   * download calls and Webhook 2.5 like a v3.0 one.
   */
  function createV21(input: EsignRequest, prepared: Prepared): Promise<EsignSession> {
    const invitee: { name: string; email?: string; phone?: string } = { name: prepared.name };
    if (prepared.email) invitee.email = prepared.email;
    if (prepared.phone) invitee.phone = prepared.phone;
    return createLegacy(
      '/v2.1/sign/request',
      v21Request({
        reference: prepared.reference,
        documentName: documentName(input.documentName),
        fileBase64: Buffer.from(input.documentBytes).toString('base64'),
        invitee,
        positions: input.signaturePositions ?? [],
        mapping,
        callbackUrl: input.callbackUrl,
        redirectUrl: input.redirectUrl,
      }),
      prepared,
    );
  }

  /**
   * Sends one pack through the v4 workflow with the signer's appearances at the positions
   * (https://knowledge.leegality.com/document-execution/api/create-pack-sync). The sync call
   * answers with the pack, its document and the signer's `invitationUrl` in one response.
   */
  async function createV4(
    input: EsignRequest,
    prepared: Prepared,
    workflow: LeegalityV4Workflow,
  ): Promise<EsignSession> {
    const invitee: { name: string; email?: string; phone?: string } = { name: prepared.name };
    if (prepared.email) invitee.email = prepared.email;
    if (prepared.phone) invitee.phone = prepared.phone;
    const { body, inviteeDetailsUuid } = packRequest({
      workflow,
      reference: prepared.reference,
      documentName: documentName(input.documentName),
      fileBase64: Buffer.from(input.documentBytes).toString('base64'),
      invitee,
      positions: input.signaturePositions ?? [],
      mapping,
      callbackUrl: input.callbackUrl,
      redirectUrl: input.redirectUrl,
    });
    const created = await request(
      `${baseUrl}/v4/pack/sync`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      http,
      (res) => readJson<PackCreated>(res),
      explainV4,
    );
    const packId = created.data?.pack?.packId;
    const documentId = created.data?.documents?.[0]?.documentId;
    if (
      created.code !== 'SUCCESS' ||
      typeof packId !== 'string' ||
      typeof documentId !== 'string'
    ) {
      throw v4Error(created, `${PROVIDER} did not create the pack`);
    }
    const providerRef = v4Ref(packId, documentId);
    const people = (created.data?.invitations ?? []).flatMap((i) => i.inviteeDetails ?? []);
    const person =
      people.find((p) => p.uuid === inviteeDetailsUuid) ??
      (people.length === 1 ? people[0] : undefined);
    if (!person?.invitationUrl || !isHttpsUrl(person.invitationUrl)) {
      throw missingSignUrl(providerRef);
    }
    return { providerRef, signUrl: person.invitationUrl };
  }

  async function createRequest(input: EsignRequest): Promise<EsignSession> {
    const prepared = prepare(input);
    const placed = (input.signaturePositions?.length ?? 0) > 0;
    if (placed && positionApi === 'v4' && v4) return createV4(input, prepared, v4);
    if (placed && positionApi === 'v2.1') return createV21(input, prepared);
    return createV3(input, prepared);
  }

  async function confirmV3(webhook: LeegalityWebhook): Promise<void> {
    if (!webhook.invitationUrl) {
      throw new SignError('WEBHOOK_INVALID', 'Webhook does not name the invitation', {
        provider: PROVIDER,
      });
    }
    const status = await transactionStatus(webhook.documentId);
    const row = (status.requests ?? []).find((r) => r.signUrl === webhook.invitationUrl);
    if (!row || !confirms(webhook.status!, row)) {
      throw new SignError('WEBHOOK_INVALID', 'Webhook does not match the document status', {
        provider: PROVIDER,
        providerRef: webhook.documentId,
      });
    }
  }

  /**
   * Checks a Webhook 4.0 event against Check Pack Details: the pack must hold the document
   * the mac signs, and its signer's `invitationStatus` must agree with the event.
   */
  async function confirmV4(webhook: LeegalityWebhook, packId: string): Promise<void> {
    const mismatch = () =>
      new SignError('WEBHOOK_INVALID', 'Webhook does not match the pack status', {
        provider: PROVIDER,
        providerRef: v4Ref(packId, webhook.documentId),
      });
    const details = await packDetails(packId);
    if (!(details.documents ?? []).some((d) => d.documentId === webhook.documentId)) {
      throw mismatch();
    }
    const signers = (details.invitations ?? [])
      .filter((i) => i.inviteeType === undefined || i.inviteeType === 'signer')
      .flatMap((i) => i.inviteeDetails ?? []);
    const status = signers.length === 1 ? signers[0]?.invitationStatus?.status : undefined;
    if (!status || !confirmsV4(webhook.status!, status)) throw mismatch();
  }

  async function parseWebhook(
    webhookHeaders: WebhookHeaders,
    rawBody: string | Uint8Array,
  ): Promise<EsignEvent | null> {
    if (options.webhookHeader) checkHeader(webhookHeaders, options.webhookHeader);
    const webhook = verifyWebhook(rawBody, privateSalt);
    if (webhook.status === null) return null;
    if (confirmWebhooks) {
      if (webhook.packId) await confirmV4(webhook, webhook.packId);
      else await confirmV3(webhook);
    }
    const providerRef = webhook.packId
      ? v4Ref(webhook.packId, webhook.documentId)
      : webhook.documentId;
    const event: EsignEvent = { providerRef, status: webhook.status };
    if (webhook.signerName) event.signerName = webhook.signerName;
    return event;
  }

  /** Reads a PDF download, refusing anything else and anything over the size limit. */
  async function readPdf(res: Response, what: string): Promise<Uint8Array> {
    const bytes = await readLimited(res, maxSignedBytes);
    if (!bytes) {
      throw new SignError('DOCUMENT_TOO_LARGE', `${what} from Leegality is too large`, {
        limit: maxSignedBytes,
      });
    }
    if (!isPdf(bytes)) {
      throw new SignError('DOCUMENT_INVALID', 'Leegality returned a file that is not a PDF', {
        provider: PROVIDER,
      });
    }
    return bytes;
  }

  /**
   * One file of a completed document. The endpoint answers with the PDF itself, or with JSON
   * that holds a short-lived download link (`data.file`), which is then fetched without the
   * auth token.
   */
  async function download(
    providerRef: string,
    type: 'DOCUMENT' | 'AUDIT_TRAIL',
    what: string,
  ): Promise<Uint8Array> {
    required(providerRef, 'providerRef');
    const pack = parseV4Ref(providerRef);
    if (pack) return downloadV4(pack, type, what);
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
      `&documentDownloadType=${type}`;
    const link = await request(
      url,
      { method: 'GET', headers: { 'X-Auth-Token': authToken } },
      http,
      async (res): Promise<Uint8Array | string> => {
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('json')) return readPdf(res, what);
        const envelope = await readEnvelope<{ file?: unknown }>(res);
        const file = envelope.data?.file;
        if (envelope.status === 1 && typeof file === 'string' && isHttpsUrl(file)) return file;
        throw envelopeError(envelope);
      },
    );
    if (typeof link !== 'string') return link;
    return request(link, { method: 'GET' }, http, (res) => readPdf(res, what));
  }

  /**
   * One file of a completed v4 pack, from `GET /api/v4/packs/download`
   * (https://knowledge.leegality.com/document-execution/api/download-files). `mode=stream`
   * asks for the file itself; an account set up for links answers with `data.url` instead.
   */
  async function downloadV4(
    pack: { packId: string; documentId: string },
    type: 'DOCUMENT' | 'AUDIT_TRAIL',
    what: string,
  ): Promise<Uint8Array> {
    const details = await packDetails(pack.packId);
    const document = (details.documents ?? []).find((d) => d.documentId === pack.documentId);
    if (!document) {
      throw new SignError('PROVIDER_ERROR', 'Leegality does not know this document', {
        provider: PROVIDER,
        reason: 'not_found',
        retryable: false,
      });
    }
    if (document.status !== 'COMPLETED') {
      throw new SignError('INVALID_STATE', 'The document is not signed by everyone yet', {
        provider: PROVIDER,
        providerRef: v4Ref(pack.packId, pack.documentId),
      });
    }
    const url =
      `${baseUrl}/v4/packs/download?downloadType=${type}` +
      `&documentId=${encodeURIComponent(pack.documentId)}&mode=stream`;
    const link = await request(
      url,
      { method: 'GET', headers: { 'X-Auth-Token': authToken } },
      http,
      async (res): Promise<Uint8Array | string> => {
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('json')) return readPdf(res, what);
        const body = await readJson<{ data?: { url?: unknown } }>(res);
        const file = body.data?.url;
        if (typeof file === 'string' && isHttpsUrl(file)) return file;
        throw v4Error(body, `${PROVIDER} returned no download link`);
      },
      explainV4,
    );
    if (typeof link !== 'string') return link;
    return request(link, { method: 'GET' }, http, (res) => readPdf(res, what));
  }

  const fetchSignedDocument = (providerRef: string) =>
    download(providerRef, 'DOCUMENT', 'Signed document');

  const fetchAuditTrail = (providerRef: string) =>
    download(providerRef, 'AUDIT_TRAIL', 'The audit trail');

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
    environment: baseUrl === LEEGALITY_BASE_URLS.production ? 'production' : options.environment,
    createRequest,
    parseWebhook,
    fetchSignedDocument,
    fetchAuditTrail,
    webhookRef: peekDocumentId,
    checkCredentials,
  };
}
