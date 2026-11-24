import { SignError } from '@codevibe_technology/sign-core';
import { describe, expect, it, vi } from 'vitest';
import type { EsignRequest, PageBox } from '../provider';
import { createLeegalityProvider, type LeegalityOptions } from './provider';
import { computeMac } from './webhook';

const SALT = 'test-private-salt';
const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');
const SIGN_URL = 'https://sandbox.leegality.com/sign/7d1c2b3a-0e4f-4a5b-8c6d-9e0f1a2b3c4d';
const A4: PageBox = { x: 0, y: 0, width: 595, height: 842, rotation: 0 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init: RequestInit) => Response;

function setup(handler: Handler, overrides: Partial<LeegalityOptions> = {}) {
  const fetch = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {})),
  );
  const provider = createLeegalityProvider({
    authToken: 'legacy-auth-token',
    privateSalt: SALT,
    profileId: 'wf-v3',
    environment: 'sandbox',
    fetch,
    ...overrides,
  });
  return { provider, fetch };
}

const signRequest = (overrides: Partial<EsignRequest> = {}): EsignRequest => ({
  envelopeId: 'env_01HX',
  reference: 'ses_01HX',
  recipient: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210' },
  documentBytes: PDF,
  documentName: 'Offer letter (2026).pdf',
  signaturePositions: [{ page: 0, rect: { x: 72, y: 600, width: 160, height: 48 }, pageBox: A4 }],
  callbackUrl: 'https://sign.example.com/v1/esign/webhooks/leegality',
  redirectUrl: 'https://sign.example.com/sign?esign=return',
  ...overrides,
});

// The 2.1 response, as the v2.1 OpenAPI schema `RequestApiResponse` describes it.
const created = {
  status: 1,
  messages: [{ code: 'request.created', message: 'Invitations sent successfully.' }],
  data: {
    documentId: 'DOC21',
    irn: 'ses_01HX',
    invitations: [
      {
        name: 'Asha Rao',
        email: 'asha@example.com',
        phone: '9876543210',
        signUrl: SIGN_URL,
        active: true,
        expiryDate: '04-12-2026 23:59:59',
      },
    ],
  },
};

const sent = (fetch: ReturnType<typeof setup>['fetch'], call = 0) =>
  JSON.parse(String(fetch.mock.calls[call]![1]!.body)) as {
    file: { name: string; file: string };
    irn: string;
    invitees: Record<string, unknown>[];
  };

describe('createRequest with the 2.1 API', () => {
  it('sends a placed box as the invitee appearance, with the legacy Auth Token', async () => {
    const { provider, fetch } = setup(() => json(created));
    await expect(provider.createRequest(signRequest())).resolves.toEqual({
      providerRef: 'DOC21',
      signUrl: SIGN_URL,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://sandbox.leegality.com/api/v2.1/sign/request');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect((init!.headers as Record<string, string>)['X-Auth-Token']).toBe('legacy-auth-token');
    const body = sent(fetch);
    expect(Object.keys(body).sort()).toEqual(['file', 'invitees', 'irn']);
    expect(body.file).toEqual({
      name: 'Offer_letter_(2026).pdf',
      file: Buffer.from(PDF).toString('base64'),
    });
    expect(body.irn).toBe('ses_01HX');
    expect(body.invitees).toEqual([
      {
        name: 'Asha Rao',
        email: 'asha@example.com',
        phone: '9876543210',
        appearances: [{ page: '1', x1: 72, y1: 194, x2: 232, y2: 242 }],
        signatures: [{ type: 'AADHAAR', config: { authTypes: ['OTP'] } }],
        webhook: {
          success: 'https://sign.example.com/v1/esign/webhooks/leegality',
          failure: 'https://sign.example.com/v1/esign/webhooks/leegality',
          version: 2.5,
        },
        redirectUrl: 'https://sign.example.com/sign?esign=return',
      },
    ]);
  });

  it('numbers pages from 1 and converts each page by its own box and the setting', async () => {
    const { provider, fetch } = setup(() => json(created), {
      coordinates: { units: 'points', origin: 'top-left' },
    });
    const turned: PageBox = { ...A4, rotation: 90 };
    await provider.createRequest(
      signRequest({
        signaturePositions: [
          { page: 2, rect: { x: 100, y: 50, width: 160, height: 48 }, pageBox: turned },
        ],
      }),
    );
    expect(sent(fetch).invitees[0]!.appearances).toEqual([
      { page: '3', x1: 100, y1: 50, x2: 260, y2: 98 },
    ]);
    const bottom = setup(() => json(created));
    await bottom.provider.createRequest(
      signRequest({
        signaturePositions: [
          { page: 2, rect: { x: 100, y: 50, width: 160, height: 48 }, pageBox: turned },
        ],
      }),
    );
    expect(sent(bottom.fetch).invitees[0]!.appearances).toEqual([
      { page: '3', x1: 50, y1: 100, x2: 98, y2: 260 },
    ]);
  });

  it('keeps the v3.0 workflow for a request without a box', async () => {
    const { provider, fetch } = setup(() =>
      json({ status: 1, data: { documentId: 'DOC3', invitees: [{ signUrl: SIGN_URL }] } }),
    );
    await provider.createRequest(signRequest({ signaturePositions: [] }));
    expect(fetch.mock.calls[0]![0]).toBe('https://sandbox.leegality.com/api/v3.0/sign/request');
    expect(sent(fetch)).toMatchObject({ profileId: 'wf-v3' });
  });

  it('maps a refusal and a missing signing link', async () => {
    const refused = setup(() =>
      json({ status: 0, messages: [{ code: 'invalid.appearance', message: 'Bad coordinates' }] }),
    );
    const error = await refused.provider.createRequest(signRequest()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SignError);
    expect(error).toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'Leegality: Bad coordinates',
      details: { providerCodes: ['invalid.appearance'] },
    });
    const noLink = setup(() =>
      json({ status: 1, data: { documentId: 'DOC21', invitations: [{ signUrl: 'http://x' }] } }),
    );
    await expect(noLink.provider.createRequest(signRequest())).rejects.toMatchObject({
      details: { reason: 'missing_sign_url', providerRef: 'DOC21' },
    });
  });

  it('refuses positionApi v4 without a v4 workflow, and an unknown one', () => {
    expect(() => setup(() => json({}), { positionApi: 'v4' })).toThrow(/needs the v4 workflow/);
    expect(() => setup(() => json({}), { positionApi: 'v3' as 'off' })).toThrow(/v2.1, v4 or off/);
  });

  it('follows the document with the v3.2 status call and a version 2.5 webhook', async () => {
    const { provider, fetch } = setup(() =>
      json({
        status: 1,
        data: { documentId: 'DOC21', requests: [{ signUrl: SIGN_URL, signed: true }] },
      }),
    );
    const body = JSON.stringify({
      documentId: 'DOC21',
      mac: computeMac('DOC21', SALT),
      request: { action: 'Signed', name: 'ASHA RAO', invitationUrl: SIGN_URL },
    });
    await expect(provider.parseWebhook({}, body)).resolves.toEqual({
      providerRef: 'DOC21',
      status: 'signed',
      signerName: 'ASHA RAO',
    });
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://sandbox.leegality.com/api/v3.2/sign/request?documentId=DOC21',
    );
  });
});
