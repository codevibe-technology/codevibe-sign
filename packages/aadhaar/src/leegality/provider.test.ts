import { SignError } from '@codevibe_technology/sign-core';
import { describe, expect, it, vi } from 'vitest';
import type { EsignRequest } from '../provider';
import { createLeegalityProvider, type LeegalityOptions } from './provider';
import { MAX_JSON_RESPONSE_BYTES } from './api';
import { computeMac, MAX_WEBHOOK_BYTES } from './webhook';

const SALT = 'test-private-salt';
const TOKEN = 'test-auth-token';
const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');
const SIGN_URL = 'https://sandbox.leegality.com/sign/2bdcc3ef-661f-440c-b059-82c0ff6ce4d8';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(handler: Handler, overrides: Partial<LeegalityOptions> = {}) {
  const fetch = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {})),
  );
  const provider = createLeegalityProvider({
    authToken: TOKEN,
    privateSalt: SALT,
    profileId: 'wf-123',
    environment: 'sandbox',
    fetch,
    ...overrides,
  });
  return { provider, fetch };
}

function signRequest(overrides: Partial<EsignRequest> = {}): EsignRequest {
  return {
    envelopeId: 'env_01HX',
    recipient: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210' },
    documentBytes: PDF,
    documentName: 'Offer letter (2026).pdf',
    signaturePositions: [{ page: 0, rect: { x: 72, y: 600, width: 160, height: 48 } }],
    callbackUrl: 'https://sign.example.com/hooks/leegality',
    redirectUrl: 'https://sign.example.com/done',
    ...overrides,
  };
}

const created = {
  status: 1,
  messages: [{ code: 'simpleWorkFlow.success', message: 'Invitations sent successfully.' }],
  data: {
    documentId: 'DOC123',
    irn: 'env_01HX',
    invitees: [
      { name: 'Reviewer', email: 'legal@example.com', signUrl: 'https://x/sign/other' },
      { name: 'Asha Rao', email: 'ASHA@example.com', phone: '9876543210', signUrl: SIGN_URL },
    ],
  },
};

async function caught(promise: Promise<unknown>): Promise<SignError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SignError) return error;
    throw error;
  }
  throw new Error('expected a SignError');
}

describe('createLeegalityProvider options', () => {
  it('requires the auth token, private salt and workflow id', () => {
    const base = {
      authToken: TOKEN,
      privateSalt: SALT,
      profileId: 'wf',
      environment: 'sandbox' as const,
    };
    expect(() => createLeegalityProvider({ ...base, authToken: '' })).toThrow(SignError);
    expect(() => createLeegalityProvider({ ...base, privateSalt: ' ' })).toThrow(SignError);
    expect(() => createLeegalityProvider({ ...base, profileId: '' })).toThrow(SignError);
  });

  it('sends the auth token only over https, except to localhost', () => {
    const base = {
      authToken: TOKEN,
      privateSalt: SALT,
      profileId: 'wf',
      environment: 'sandbox' as const,
    };
    for (const baseUrl of [
      'http://leegality.example.com/api',
      'ftp://leegality.example.com',
      'https://user:secret@leegality.example.com/api',
      'not a url',
    ]) {
      expect(() => createLeegalityProvider({ ...base, baseUrl })).toThrow(/baseUrl/);
    }
    expect(() =>
      createLeegalityProvider({ ...base, baseUrl: 'http://localhost:8080/api' }),
    ).not.toThrow();
    expect(() =>
      createLeegalityProvider({ ...base, baseUrl: 'https://proxy.example.com/leegality/' }),
    ).not.toThrow();
  });

  it('rejects a timeout that would not bound the call', () => {
    const base = {
      authToken: TOKEN,
      privateSalt: SALT,
      profileId: 'wf',
      environment: 'sandbox' as const,
    };
    for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3_600_000]) {
      expect(() => createLeegalityProvider({ ...base, timeoutMs })).toThrow(/timeoutMs/);
    }
  });

  it('rejects an unknown environment', () => {
    expect(() =>
      createLeegalityProvider({
        authToken: TOKEN,
        privateSalt: SALT,
        profileId: 'wf',
        environment: 'staging' as 'sandbox',
      }),
    ).toThrow(/environment/);
  });
});

describe('createRequest', () => {
  it('posts the documented body with the auth header', async () => {
    const { provider, fetch } = setup(() => json(created));
    const session = await provider.createRequest(signRequest());

    expect(session).toEqual({ providerRef: 'DOC123', signUrl: SIGN_URL });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://sandbox.leegality.com/api/v3.0/sign/request');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'X-Auth-Token': TOKEN,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      profileId: 'wf-123',
      file: { name: 'Offer_letter_(2026).pdf', file: Buffer.from(PDF).toString('base64') },
      invitees: [{ name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210' }],
      irn: 'env_01HX',
    });
  });

  it('uses the production base URL and a per-request workflow', async () => {
    const profileId = vi.fn(() => 'wf-two-page');
    const { provider, fetch } = setup(() => json(created), {
      environment: 'production',
      profileId,
    });
    await provider.createRequest(signRequest());
    expect(fetch.mock.calls[0]![0]).toBe('https://app1.leegality.com/api/v3.0/sign/request');
    expect(profileId).toHaveBeenCalledWith(expect.objectContaining({ envelopeId: 'env_01HX' }));
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).profileId).toBe('wf-two-page');
  });

  it('accepts a returned documentId even when status is 0, as in the published sample', async () => {
    const { provider } = setup(() => json({ ...created, status: 0 }));
    await expect(provider.createRequest(signRequest())).resolves.toMatchObject({
      providerRef: 'DOC123',
    });
  });

  it('falls back to the only invitee when contact details differ in format', async () => {
    const only = { ...created, data: { ...created.data, invitees: [{ signUrl: SIGN_URL }] } };
    const { provider } = setup(() => json(only));
    await expect(provider.createRequest(signRequest())).resolves.toMatchObject({
      signUrl: SIGN_URL,
    });
  });

  it('validates input before calling the provider', async () => {
    const { provider, fetch } = setup(() => json(created));
    const cases: [Partial<EsignRequest>, string][] = [
      [{ recipient: { name: ' ' } }, 'VALIDATION'],
      [{ recipient: { name: 'Asha' } }, 'VALIDATION'],
      [{ recipient: { name: 'Asha', phone: '12345' } }, 'VALIDATION'],
      [{ envelopeId: 'has space' }, 'VALIDATION'],
      [{ documentBytes: new TextEncoder().encode('not a pdf') }, 'DOCUMENT_INVALID'],
      [{ documentBytes: new Uint8Array(15 * 1024 * 1024 + 1) }, 'DOCUMENT_TOO_LARGE'],
    ];
    for (const [override, code] of cases) {
      const error = await caught(provider.createRequest(signRequest(override)));
      expect(error.code).toBe(code);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a status 0 response to PROVIDER_ERROR with the provider codes', async () => {
    const { provider } = setup(() =>
      json({
        status: 0,
        messages: [{ code: 'profile.invalid', message: 'Workflow not found' }],
        data: {},
      }),
    );
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.message).toContain('Workflow not found');
    expect(error.details).toMatchObject({ providerCodes: ['profile.invalid'], retryable: false });
  });

  it('maps HTTP statuses', async () => {
    const expectations: [number, string, Record<string, unknown>][] = [
      [401, 'PROVIDER_ERROR', { reason: 'unauthorized', retryable: false }],
      [403, 'PROVIDER_ERROR', { reason: 'unauthorized', retryable: false }],
      [429, 'RATE_LIMITED', { retryable: true }],
      [503, 'PROVIDER_ERROR', { reason: 'unavailable', retryable: true }],
      [400, 'PROVIDER_ERROR', { reason: 'rejected', retryable: false }],
    ];
    for (const [status, code, details] of expectations) {
      const { provider } = setup(() => json({}, status));
      const error = await caught(provider.createRequest(signRequest()));
      expect(error.code).toBe(code);
      expect(error.details).toMatchObject(details);
    }
  });

  it('reports a malformed response', async () => {
    const { provider } = setup(() => new Response('<html>oops</html>', { status: 200 }));
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.details).toMatchObject({ reason: 'malformed_response' });
  });

  it('reports a missing signing link', async () => {
    const { provider } = setup(() =>
      json({ ...created, data: { documentId: 'DOC123', invitees: [] } }),
    );
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.details).toMatchObject({ reason: 'missing_sign_url', providerRef: 'DOC123' });
  });

  it.each([
    'javascript:alert(1)',
    'http://sandbox.leegality.com/sign/x',
    'data:text/html,hi',
    '/sign/x',
  ])('refuses a signing link that is not https: %s', async (signUrl) => {
    const invitees = [{ ...created.data.invitees[1], signUrl }];
    const { provider } = setup(() => json({ ...created, data: { ...created.data, invitees } }));
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.details).toMatchObject({ reason: 'missing_sign_url' });
  });

  it('refuses a JSON response that is too large to be real', async () => {
    const { provider } = setup(() =>
      json({ ...created, padding: 'x'.repeat(MAX_JSON_RESPONSE_BYTES) }),
    );
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.details).toMatchObject({ reason: 'malformed_response' });
  });

  it('maps network failures as retryable', async () => {
    const { provider } = setup(() => {
      throw new TypeError('fetch failed');
    });
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.details).toMatchObject({ reason: 'network', retryable: true });
  });

  it('times out a provider that never answers', async () => {
    const { provider } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      { timeoutMs: 20 },
    );
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.details).toMatchObject({ reason: 'timeout', retryable: true });
    expect(error.message).toContain('20 ms');
  });

  it('never puts the token or document in error details', async () => {
    const { provider } = setup(() => json({ status: 0, messages: [], data: {} }));
    const error = await caught(provider.createRequest(signRequest()));
    const serialised = JSON.stringify({ message: error.message, details: error.details });
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(Buffer.from(PDF).toString('base64'));
  });
});

function webhookBody(
  overrides: Record<string, unknown> = {},
  request: Record<string, unknown> = {},
) {
  return JSON.stringify({
    webhookType: 'Success',
    documentId: 'DOC123',
    documentStatus: 'Completed',
    irn: 'env_01HX',
    mac: computeMac('DOC123', SALT),
    messages: [],
    verification: null,
    request: {
      inviteeType: 'Signer',
      name: 'Asha Rao',
      invitationUrl: SIGN_URL,
      action: 'Signed',
      expired: false,
      ...request,
    },
    ...overrides,
  });
}

function statusResponse(row: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return json({
    status: 1,
    messages: [],
    data: { documentId: 'DOC123', files: [], requests: [{ signUrl: SIGN_URL, ...row }], ...extra },
  });
}

describe('parseWebhook', () => {
  it('computes the mac as hex HMAC-SHA1 of the document id keyed by the salt', () => {
    expect(computeMac('DOC123', SALT)).toMatch(/^[0-9a-f]{40}$/);
    expect(computeMac('DOC123', SALT)).not.toBe(computeMac('DOC124', SALT));
  });

  it('accepts a verified signed event confirmed by the status API', async () => {
    const { provider, fetch } = setup(() => statusResponse({ signed: true }));
    const event = await provider.parseWebhook({}, webhookBody());
    expect(event).toEqual({ providerRef: 'DOC123', status: 'signed', signerName: 'Asha Rao' });
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://sandbox.leegality.com/api/v3.2/sign/request?documentId=DOC123',
    );
  });

  it('accepts a byte body and an upper-case mac', async () => {
    const { provider } = setup(() => statusResponse({ signed: true }));
    const body = webhookBody({ mac: computeMac('DOC123', SALT).toUpperCase() });
    await expect(provider.parseWebhook({}, new TextEncoder().encode(body))).resolves.toMatchObject({
      status: 'signed',
    });
  });

  it.each([
    ['declined', { action: 'Rejected' }, { rejected: true }],
    ['expired', { action: null, expired: true }, { expired: true }],
  ])('maps %s', async (status, request, row) => {
    const { provider } = setup(() => statusResponse(row));
    const event = await provider.parseWebhook({}, webhookBody({ webhookType: 'Error' }, request));
    expect(event?.status).toBe(status);
  });

  it('maps a certificate verification failure to failed', async () => {
    const { provider } = setup(() => statusResponse({ expired: true }));
    const body = webhookBody(
      {
        webhookType: 'Error',
        messages: [{ code: 'name.verification.failed', message: 'mismatch' }],
      },
      { action: null, expired: true },
    );
    await expect(provider.parseWebhook({}, body)).resolves.toMatchObject({ status: 'failed' });
  });

  it('accepts a failed identity check while the invitation is still open', async () => {
    const { provider } = setup(() => statusResponse({ signed: false, expired: false }));
    const body = webhookBody(
      {
        webhookType: 'Error',
        messages: [{ code: 'name.verification.failed', message: 'mismatch' }],
      },
      { action: null },
    );
    await expect(provider.parseWebhook({}, body)).resolves.toMatchObject({ status: 'failed' });
  });

  it('refuses a failed event for an invitation the provider says is signed', async () => {
    const { provider } = setup(() => statusResponse({ signed: true }));
    const body = webhookBody(
      {
        webhookType: 'Error',
        messages: [{ code: 'name.verification.failed', message: 'mismatch' }],
      },
      { action: null },
    );
    await expect(provider.parseWebhook({}, body)).rejects.toMatchObject({
      code: 'WEBHOOK_INVALID',
    });
  });

  it('never follows a redirect with the auth token', async () => {
    const { provider, fetch } = setup(() => statusResponse({ signed: true }));
    await provider.parseWebhook({}, webhookBody());
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });

  it('returns null for a verified event that does not change the status', async () => {
    const { provider, fetch } = setup(() => statusResponse({}));
    const body = webhookBody({}, { inviteeType: 'Reviewer', action: 'Approved' });
    await expect(provider.parseWebhook({}, body)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a wrong mac', webhookBody({ mac: computeMac('DOC123', 'another-salt') })],
    ['a mac for another document', webhookBody({ mac: computeMac('DOC999', SALT) })],
    ['a missing mac', webhookBody({ mac: undefined })],
    ['a missing documentId', webhookBody({ documentId: undefined })],
    ['a body that is not JSON', 'documentId=DOC123'],
    ['a JSON array', '[]'],
  ])('rejects %s without calling the provider', async (_name, body) => {
    const { provider, fetch } = setup(() => statusResponse({ signed: true }));
    const error = await caught(provider.parseWebhook({}, body));
    expect(error.code).toBe('WEBHOOK_INVALID');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before parsing it or calling the provider', async () => {
    const { provider, fetch } = setup(() => statusResponse({ signed: true }));
    const body = webhookBody({ padding: 'x'.repeat(MAX_WEBHOOK_BYTES) });
    const error = await caught(provider.parseWebhook({}, body));
    expect(error.code).toBe('WEBHOOK_INVALID');
    expect(error.message).toMatch(/too large/);
    const bytes = await caught(provider.parseWebhook({}, new TextEncoder().encode(body)));
    expect(bytes.code).toBe('WEBHOOK_INVALID');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a verified body whose status the provider does not confirm', async () => {
    const { provider } = setup(() => statusResponse({ signed: false }));
    const error = await caught(provider.parseWebhook({}, webhookBody()));
    expect(error.code).toBe('WEBHOOK_INVALID');
  });

  it('rejects a body naming an invitation the document does not have', async () => {
    const { provider } = setup(() => statusResponse({ signed: true }));
    const body = webhookBody({}, { invitationUrl: 'https://sandbox.leegality.com/sign/other' });
    expect((await caught(provider.parseWebhook({}, body))).code).toBe('WEBHOOK_INVALID');
  });

  it('skips confirmation when turned off', async () => {
    const { provider, fetch } = setup(() => statusResponse({}), { confirmWebhooks: false });
    await expect(provider.parseWebhook({}, webhookBody())).resolves.toMatchObject({
      status: 'signed',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks a configured static header', async () => {
    const { provider } = setup(() => statusResponse({ signed: true }), {
      webhookHeader: { name: 'Authorization', value: 'Bearer hook-secret' },
    });
    const missing = await caught(provider.parseWebhook({}, webhookBody()));
    expect(missing.code).toBe('WEBHOOK_INVALID');
    const wrong = await caught(
      provider.parseWebhook({ authorization: 'Bearer nope' }, webhookBody()),
    );
    expect(wrong.code).toBe('WEBHOOK_INVALID');
    await expect(
      provider.parseWebhook(new Headers({ Authorization: 'Bearer hook-secret' }), webhookBody()),
    ).resolves.toMatchObject({ status: 'signed' });
    await expect(
      provider.parseWebhook({ authorization: ['Bearer hook-secret'] }, webhookBody()),
    ).resolves.toMatchObject({ status: 'signed' });
  });
});

describe('fetchSignedDocument', () => {
  const signedPdf = new TextEncoder().encode('%PDF-1.7\nsigned\n');

  function routes(
    binary: () => Response,
    extra: Record<string, unknown> = { auditTrail: 'https://cdn/a' },
  ) {
    return (url: string) =>
      url.includes('/v3.2/sign/request') ? statusResponse({ signed: true }, extra) : binary();
  }

  it('downloads the signed PDF once the document is complete', async () => {
    const { provider, fetch } = setup(
      routes(() => new Response(signedPdf, { headers: { 'content-type': 'application/pdf' } })),
    );
    await expect(provider.fetchSignedDocument('DOC123')).resolves.toEqual(signedPdf);
    expect(fetch.mock.calls[1]![0]).toBe(
      'https://sandbox.leegality.com/api/v3.1/document/fetchDocument?documentId=DOC123&documentDownloadType=DOCUMENT',
    );
    expect(fetch.mock.calls[1]![1]?.headers).toMatchObject({ 'X-Auth-Token': TOKEN });
  });

  it('refuses before every signer has signed', async () => {
    const { provider, fetch } = setup(routes(() => new Response(signedPdf), {}));
    const error = await caught(provider.fetchSignedDocument('DOC123'));
    expect(error.code).toBe('INVALID_STATE');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps a JSON error from the download endpoint', async () => {
    const { provider } = setup(
      routes(() => json({ status: 0, messages: [{ code: 'no.document.found' }], data: {} })),
    );
    const error = await caught(provider.fetchSignedDocument('DOC123'));
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.details).toMatchObject({
      reason: 'not_found',
      providerCodes: ['no.document.found'],
    });
  });

  it('rejects a file that is not a PDF or is too large', async () => {
    const notPdf = setup(
      routes(() => new Response('hello', { headers: { 'content-type': 'application/pdf' } })),
    );
    expect((await caught(notPdf.provider.fetchSignedDocument('DOC123'))).code).toBe(
      'DOCUMENT_INVALID',
    );

    const big = setup(
      routes(() => new Response(signedPdf)),
      { maxSignedDocumentBytes: 4 },
    );
    expect((await caught(big.provider.fetchSignedDocument('DOC123'))).code).toBe(
      'DOCUMENT_TOO_LARGE',
    );
  });

  it('stops reading a download that runs past the limit without a length header', async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(pulled === 1 ? signedPdf : new Uint8Array(1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'application/pdf' } },
      );
    const { provider } = setup(routes(endless), { maxSignedDocumentBytes: 10 * 1024 });
    const error = await caught(provider.fetchSignedDocument('DOC123'));
    expect(error.code).toBe('DOCUMENT_TOO_LARGE');
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(20);
  });

  it('refuses a download whose declared length is over the limit without reading it', async () => {
    let pulled = 0;
    const declared = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(signedPdf);
          },
        }),
        { headers: { 'content-type': 'application/pdf', 'content-length': '999999999' } },
      );
    const { provider } = setup(routes(declared), { maxSignedDocumentBytes: 1024 });
    expect((await caught(provider.fetchSignedDocument('DOC123'))).code).toBe('DOCUMENT_TOO_LARGE');
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('times out a download that stalls mid-body', async () => {
    const stalled = (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(signedPdf.slice(0, 5));
          init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/pdf' } });
    };
    const { provider } = setup(
      (url, init) =>
        url.includes('/v3.2/')
          ? statusResponse({ signed: true }, { auditTrail: 'x' })
          : stalled(url, init),
      { timeoutMs: 30 },
    );
    const error = await caught(provider.fetchSignedDocument('DOC123'));
    expect(error.details).toMatchObject({ reason: 'timeout' });
  });

  it('maps an unknown document on the status check', async () => {
    const { provider } = setup(() =>
      json({
        status: 0,
        messages: [{ code: 'no.document.found', message: 'No document found' }],
        data: {},
      }),
    );
    const error = await caught(provider.fetchSignedDocument('NOPE'));
    expect(error.details).toMatchObject({ reason: 'not_found' });
  });
});

describe('webhookRef', () => {
  it('reads the document id without checking the mac', () => {
    const { provider } = setup(() => json({}));
    expect(provider.webhookRef?.(JSON.stringify({ documentId: 'DOC123', mac: 'nope' }))).toBe(
      'DOC123',
    );
    expect(provider.webhookRef?.(new TextEncoder().encode('{"documentId":"DOC9"}'))).toBe('DOC9');
  });

  it('answers null for a body that names no document', () => {
    const { provider } = setup(() => json({}));
    expect(provider.webhookRef?.('not json')).toBeNull();
    expect(provider.webhookRef?.('[]')).toBeNull();
    expect(provider.webhookRef?.('{"documentId":7}')).toBeNull();
    expect(provider.webhookRef?.('x'.repeat(MAX_WEBHOOK_BYTES + 1))).toBeNull();
  });
});

describe('checkCredentials', () => {
  const notFound = {
    status: 0,
    messages: [{ code: 'no.document.found', message: 'No document found' }],
  };

  it('accepts an account that answers "no document found"', async () => {
    const { provider, fetch } = setup(() => json(notFound));
    await expect(provider.checkCredentials?.()).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toContain('/v3.2/sign/request?documentId=check-');
    expect(init?.method).toBe('GET');
  });

  it('refuses credentials the provider rejects', async () => {
    const { provider } = setup(() => json({}, 401));
    await expect(provider.checkCredentials?.()).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      details: { reason: 'unauthorized' },
    });
  });

  it('refuses another rejection and an unexpected success', async () => {
    const rejected = setup(() =>
      json({ status: 0, messages: [{ code: 'auth.invalid', message: 'Invalid token' }] }),
    );
    await expect(rejected.provider.checkCredentials?.()).rejects.toMatchObject({
      details: { reason: 'rejected' },
    });
    const odd = setup(() => json({ status: 1, data: { documentId: 'x' } }));
    await expect(odd.provider.checkCredentials?.()).rejects.toMatchObject({
      details: { reason: 'malformed_response' },
    });
  });
});

describe('reference', () => {
  it('sends its own reference as the irn when given', async () => {
    const { provider, fetch } = setup(() => json(created));
    await provider.createRequest(signRequest({ reference: 'es_abc123' }));
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body)) as { irn: string };
    expect(body.irn).toBe('es_abc123');
  });
});
