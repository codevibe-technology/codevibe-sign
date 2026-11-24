import { SignError } from '@codevibe_technology/sign-core';
import { describe, expect, it, vi } from 'vitest';
import type { EsignRequest, PageBox } from '../provider';
import { createLeegalityProvider, type LeegalityOptions } from './provider';
import { leegalityV4WorkflowFromPayload, parseV4Ref, v4Ref, type LeegalityV4Workflow } from './v4';
import { computeMac, peekDocumentId } from './webhook';

const SALT = 'test-private-salt';
const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');
const SIGN_URL = 'https://sandbox.leegality.com/sign/4f2a1c55-0d43-4a8a-9b0e-8c1d2e3f4a5b';
const PACK = '01KZ8JV4Z7T3EZWMXGF3RNAYR5';
const DOC = '01KZ8JV503BJMY8QHCDS86DAR4';
const A4: PageBox = { x: 0, y: 0, width: 595, height: 842, rotation: 0 };

const WORKFLOW: Required<LeegalityV4Workflow> = {
  workflowId: '70843c25-8d80-40ac-ab6b-edba12abd495',
  documentUuid: '711abfff-2057-48ac-909e-519f3f7415a4',
  subDocumentUuid: '795df69d-12c9-4959-be9a-9a73a2e1dd30',
  inviteeUuid: '8bc21487-b200-4130-8240-a5f1715244dc',
  inviteeDetailsUuid: '1aa11111-1111-4111-8111-111111111111',
  combinationUuid: '29bdb6fd-99a9-4501-b74b-d482d7ad5062',
  assignedDocumentUuid: 'cd7c1c46-af20-4452-9f6c-ca507705a8b9',
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: Handler, overrides: Partial<LeegalityOptions> = {}) {
  const fetch = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {})),
  );
  const provider = createLeegalityProvider({
    authToken: 'test-auth-token',
    privateSalt: SALT,
    profileId: 'wf-v3',
    environment: 'sandbox',
    v4: WORKFLOW,
    fetch,
    ...overrides,
  });
  return { provider, fetch };
}

function signRequest(overrides: Partial<EsignRequest> = {}): EsignRequest {
  return {
    envelopeId: 'env_01HX',
    reference: 'ses_01HX',
    recipient: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210' },
    documentBytes: PDF,
    documentName: 'Offer letter (2026).pdf',
    signaturePositions: [{ page: 0, rect: { x: 72, y: 600, width: 160, height: 48 }, pageBox: A4 }],
    callbackUrl: 'https://sign.example.com/v1/esign/webhooks/leegality',
    redirectUrl: 'https://sign.example.com/sign?esign=return',
    ...overrides,
  };
}

const packCreated = {
  code: 'SUCCESS',
  message: 'Pack created',
  data: {
    workflowRunContextId: 'b7c4f1e2-9a0d-4c3b-8f11-2a5d6e7f8a90',
    pack: { packId: PACK, packIrn: 'ses_01HX', packUrn: 'ses_01HX', packName: 'Offer letter' },
    documents: [{ documentId: DOC, documentName: 'Offer letter', irn: 'ses_01HX' }],
    invitations: [
      {
        uuid: 'c2b2f8d0-0000-4000-8000-000000000001',
        type: 'SIGNER',
        level: 1,
        inviteeDetails: [
          { uuid: WORKFLOW.inviteeDetailsUuid, inviteeName: 'Asha Rao', invitationUrl: SIGN_URL },
        ],
      },
    ],
  },
};

const packDetails = (invitation: string, document = 'SENT') => ({
  data: {
    pack: { packId: PACK, status: document === 'COMPLETED' ? 'COMPLETED' : 'SENT' },
    documents: [{ documentId: DOC, status: document }],
    invitations: [
      {
        inviteeType: 'signer',
        inviteeDetails: [
          {
            invitationUrl: SIGN_URL,
            invitationStatus: { status: invitation, failureReason: null },
          },
        ],
      },
    ],
  },
});

interface SentPack {
  workflowId: string;
  pack: unknown;
  documents: { uuid: string; subDocuments: { uuid: string }[] }[];
  invitees: {
    uuid: string;
    combinations: { uuid: string; assignedDocuments: { documentUuid: string }[] }[];
  }[];
  coordinates: { inviteeUuid: string; appearances: Record<string, unknown>[] }[];
}

const sentBody = (fetch: ReturnType<typeof setup>['fetch'], call = 0) =>
  JSON.parse(fetch.mock.calls[call]![1]!.body as string) as SentPack;

async function caught(promise: Promise<unknown>): Promise<SignError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SignError) return error;
    throw error;
  }
  throw new Error('expected a SignError');
}

describe('createRequest with a v4 workflow', () => {
  it('sends a pack through the v4 sync API with the appearance at the box', async () => {
    const { provider, fetch } = setup(() => json(packCreated, 201));
    const session = await provider.createRequest(signRequest());
    expect(session).toEqual({ providerRef: `v4:${PACK}:${DOC}`, signUrl: SIGN_URL });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://sandbox.leegality.com/api/v4/pack/sync');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect((init!.headers as Record<string, string>)['X-Auth-Token']).toBe('test-auth-token');
    const body = sentBody(fetch);
    expect(body.workflowId).toBe(WORKFLOW.workflowId);
    expect(body.pack).toEqual({
      packName: 'Offer_letter_(2026).pdf',
      packIrn: 'ses_01HX',
      packUrn: 'ses_01HX',
    });
    expect(body.documents).toEqual([
      {
        uuid: WORKFLOW.documentUuid,
        documentName: 'Offer_letter_(2026).pdf',
        irn: 'ses_01HX',
        subDocuments: [
          { uuid: WORKFLOW.subDocumentUuid, file: Buffer.from(PDF).toString('base64') },
        ],
      },
    ]);
    const invitee = body.invitees[0]!;
    expect(invitee).toMatchObject({
      uuid: WORKFLOW.inviteeUuid,
      type: 'signer',
      level: 1,
      inviteeDetails: [
        {
          uuid: WORKFLOW.inviteeDetailsUuid,
          inviteeName: 'Asha Rao',
          inviteeEmail: 'asha@example.com',
          inviteePhone: '9876543210',
        },
      ],
      inviteeSettings: {
        manageInviteInteractions: { redirectUrl: 'https://sign.example.com/sign?esign=return' },
      },
    });
    expect(invitee.combinations[0]!).toEqual({
      uuid: WORKFLOW.combinationUuid,
      assignedDocuments: [
        {
          uuid: WORKFLOW.assignedDocumentUuid,
          documentUuid: WORKFLOW.documentUuid,
          role: 'signer',
        },
      ],
      combinationSettings: {
        esignTypes: {
          aadharEsign: { aadharEsignEnabled: true, aadhaarEsignConfig: { aadhaarOtp: true } },
        },
        webhooks: {
          successWebhook: 'https://sign.example.com/v1/esign/webhooks/leegality',
          errorWebhook: 'https://sign.example.com/v1/esign/webhooks/leegality',
          webhookVersion: 'VERSION_4.0',
        },
      },
    });
    expect(body.coordinates).toEqual([
      {
        uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
        inviteeUuid: WORKFLOW.inviteeUuid,
        appearances: [
          {
            uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
            documentUuid: WORKFLOW.documentUuid,
            subDocumentUuid: WORKFLOW.subDocumentUuid,
            combinationUuid: WORKFLOW.combinationUuid,
            pageNo: '1',
            rect: { x1Axis: '72', y1Axis: '194', x2Axis: '232', y2Axis: '242' },
            type: 'CUSTOM',
            subDocumentType: 'PDF',
          },
        ],
      },
    ]);
  });

  it('converts with the configured origin and units', async () => {
    const { provider, fetch } = setup(() => json(packCreated, 201), {
      coordinates: { units: { pixelsPerInch: 96 }, origin: 'top-left' },
    });
    await provider.createRequest(signRequest());
    expect(sentBody(fetch).coordinates[0]!.appearances[0]!.rect).toEqual({
      x1Axis: '96',
      y1Axis: '800',
      x2Axis: '309',
      y2Axis: '864',
    });
  });

  it('numbers pages from 1 and places each page by its own box', async () => {
    const { provider, fetch } = setup(() => json(packCreated, 201));
    const turned: PageBox = { ...A4, rotation: 90 };
    await provider.createRequest(
      signRequest({
        signaturePositions: [
          { page: 3, rect: { x: 100, y: 50, width: 160, height: 48 }, pageBox: turned },
        ],
      }),
    );
    expect(sentBody(fetch).coordinates[0]!.appearances[0]!).toMatchObject({
      pageNo: '4',
      rect: { x1Axis: '50', y1Axis: '100', x2Axis: '98', y2Axis: '260' },
    });
  });

  it('generates the ids the workflow does not give', async () => {
    const { provider, fetch } = setup(() => json(packCreated, 201), {
      v4: { workflowId: WORKFLOW.workflowId },
    });
    await provider.createRequest(signRequest());
    const body = sentBody(fetch);
    const documentUuid = body.documents[0]!.uuid;
    expect(documentUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.invitees[0]!.combinations[0]!.assignedDocuments[0]!.documentUuid).toBe(
      documentUuid,
    );
    expect(body.coordinates[0]!.inviteeUuid).toBe(body.invitees[0]!.uuid);
    expect(body.coordinates[0]!.appearances[0]!).toMatchObject({
      documentUuid,
      subDocumentUuid: body.documents[0]!.subDocuments[0]!.uuid,
      combinationUuid: body.invitees[0]!.combinations[0]!.uuid,
    });
  });

  it('uses the v3.0 request when there is no position or placing is off', async () => {
    const created = {
      status: 1,
      data: { documentId: 'DOC123', invitees: [{ name: 'Asha Rao', signUrl: SIGN_URL }] },
    };
    const { provider, fetch } = setup(() => json(created));
    await provider.createRequest(signRequest({ signaturePositions: [] }));
    expect(fetch.mock.calls[0]![0]).toBe('https://sandbox.leegality.com/api/v3.0/sign/request');
    const plain = setup(() => json(created), { v4: undefined, positionApi: 'off' });
    await expect(plain.provider.createRequest(signRequest())).resolves.toEqual({
      providerRef: 'DOC123',
      signUrl: SIGN_URL,
    });
    expect(plain.fetch.mock.calls[0]![0]).toMatch(/\/v3\.0\/sign\/request$/);
  });

  it('reports the error codes of a refused pack', async () => {
    const { provider } = setup(() =>
      json(
        {
          code: 'LE_ERR_AP_007',
          traceId: null,
          errors: [{ code: 'LE_ERR_AP_007', message: 'coordinates are not allowed', path: '/' }],
        },
        400,
      ),
    );
    const error = await caught(provider.createRequest(signRequest()));
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.message).toBe('Leegality: coordinates are not allowed');
    expect(error.details).toMatchObject({ reason: 'rejected', providerCodes: ['LE_ERR_AP_007'] });
  });

  it('falls back to the HTTP status when an error body says nothing', async () => {
    const { provider } = setup(() => new Response('oops', { status: 400 }));
    expect((await caught(provider.createRequest(signRequest()))).message).toMatch(/HTTP 400/);
  });

  it('refuses a pack without a document, pack id or https signing link', async () => {
    const without = structuredClone(packCreated);
    delete (without.data as { documents?: unknown }).documents;
    expect(
      (await caught(setup(() => json(without, 201)).provider.createRequest(signRequest()))).code,
    ).toBe('PROVIDER_ERROR');
    const http = structuredClone(packCreated);
    http.data.invitations[0]!.inviteeDetails[0]!.invitationUrl = 'javascript:alert(1)';
    const error = await caught(setup(() => json(http, 201)).provider.createRequest(signRequest()));
    expect(error.details).toMatchObject({
      reason: 'missing_sign_url',
      providerRef: `v4:${PACK}:${DOC}`,
    });
  });

  it('refuses a box without its page size before calling Leegality', async () => {
    const { provider, fetch } = setup(() => json(packCreated, 201));
    const error = await caught(
      provider.createRequest(
        signRequest({
          signaturePositions: [{ page: 0, rect: { x: 1, y: 1, width: 10, height: 10 } }],
        }),
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a malformed workflow when the provider is created', () => {
    expect(() => setup(() => json({}), { v4: { workflowId: '' } })).toThrow(/workflowId/);
    expect(() => setup(() => json({}), { v4: { workflowId: 'wf 1' } })).toThrow(/workflow id/);
    expect(() =>
      setup(() => json({}), { v4: { workflowId: WORKFLOW.workflowId, documentUuid: 'doc' } }),
    ).toThrow(/documentUuid must be a UUID/);
    expect(() =>
      setup(() => json({}), { coordinates: { units: 'points', origin: 'middle' as 'top-left' } }),
    ).toThrow(/bottom-left or top-left/);
  });
});

function v4Webhook(overrides: Record<string, unknown> = {}, documentId = DOC) {
  return JSON.stringify({
    webhookType: 'SUCCESS',
    eventType: 'SIGNED',
    rejectionReason: null,
    combinationUuid: WORKFLOW.combinationUuid,
    workflowRunContextId: 'b7c4f1e2-9a0d-4c3b-8f11-2a5d6e7f8a90',
    timestamp: '30-11-2026 18:53:16',
    pack: { packId: PACK, packStatus: 'COMPLETED', packIrn: 'PIRN', packUrn: 'ses_01HX' },
    document: {
      uuid: WORKFLOW.documentUuid,
      documentId,
      documentStatus: 'COMPLETED',
      irn: 'ses_01HX',
      signatureType: 'AADHAAR',
    },
    invitationGroup: { uuid: 'g', groupName: null, groupStatus: 'COMPLETED', type: 'SIGNER' },
    invitee: {
      uuid: WORKFLOW.inviteeDetailsUuid,
      inviteeName: 'Asha Rao',
      inviteeEmail: 'asha@example.com',
      inviteePhone: '9876543210',
      invitationStatus: 'SIGNED',
    },
    messages: [],
    mac: computeMac(documentId, SALT),
    ...overrides,
  });
}

describe('Webhook 4.0', () => {
  it('accepts a signed event confirmed by Check Pack Details', async () => {
    const { provider, fetch } = setup(() => json(packDetails('SIGNED', 'COMPLETED')));
    await expect(provider.parseWebhook({}, v4Webhook())).resolves.toEqual({
      providerRef: `v4:${PACK}:${DOC}`,
      status: 'signed',
      signerName: 'Asha Rao',
    });
    expect(fetch.mock.calls[0]![0]).toBe(
      `https://sandbox.leegality.com/api/v4/packs?packId=${PACK}`,
    );
  });

  it.each([
    ['SIGNER_REJECTION', 'SIGNER_REJECTED', 'declined'],
    ['VERIFICATION_FAILED', 'EXPIRED', 'failed'],
    ['AADHAAR_RETRY_EXHAUSTED', 'EXPIRED', 'failed'],
    ['INVITATION_TIMEOUT', 'EXPIRED', 'expired'],
  ])('maps %s to its status', async (eventType, invitation, status) => {
    const { provider } = setup(() => json(packDetails(invitation)));
    const body = v4Webhook({ eventType, webhookType: 'FAILED' });
    await expect(provider.parseWebhook({}, body)).resolves.toMatchObject({ status });
  });

  it('returns null for a reviewer event without calling Leegality', async () => {
    const { provider, fetch } = setup(() => json(packDetails('SIGNED')));
    await expect(
      provider.parseWebhook({}, v4Webhook({ eventType: 'REVIEWER_APPROVAL' })),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a mac for another document', v4Webhook({ mac: computeMac('OTHER', SALT) })],
    ['a mac with another salt', v4Webhook({ mac: computeMac(DOC, 'other-salt') })],
    ['no mac', v4Webhook({ mac: undefined })],
    ['no pack id', v4Webhook({ pack: { packId: null } })],
  ])('rejects %s without calling Leegality', async (_name, body) => {
    const { provider, fetch } = setup(() => json(packDetails('SIGNED')));
    expect((await caught(provider.parseWebhook({}, body))).code).toBe('WEBHOOK_INVALID');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an event the pack status does not confirm', async () => {
    const pending = setup(() => json(packDetails('PENDING')));
    expect((await caught(pending.provider.parseWebhook({}, v4Webhook()))).code).toBe(
      'WEBHOOK_INVALID',
    );
    const otherPack = setup(() =>
      json({ data: { ...packDetails('SIGNED').data, documents: [{ documentId: 'X' }] } }),
    );
    expect((await caught(otherPack.provider.parseWebhook({}, v4Webhook()))).code).toBe(
      'WEBHOOK_INVALID',
    );
  });

  it('still verifies a version 2.5 body of a v3.0 document', async () => {
    const { provider } = setup(() => json(packDetails('SIGNED')), { confirmWebhooks: false });
    const body = JSON.stringify({
      documentId: 'DOC123',
      mac: computeMac('DOC123', SALT),
      request: { action: 'Signed', name: 'Asha Rao', invitationUrl: SIGN_URL },
    });
    await expect(provider.parseWebhook({}, body)).resolves.toMatchObject({
      providerRef: 'DOC123',
      status: 'signed',
    });
  });

  it('names the pack and document as the webhook reference', () => {
    expect(peekDocumentId(v4Webhook())).toBe(`v4:${PACK}:${DOC}`);
    expect(peekDocumentId(v4Webhook({ pack: null }))).toBeNull();
    expect(peekDocumentId(JSON.stringify({ documentId: 'DOC123' }))).toBe('DOC123');
  });
});

describe('files of a v4 pack', () => {
  const routes =
    (document: string, file: () => Response): Handler =>
    (url) =>
      url.includes('/v4/packs/download') ? file() : json(packDetails('SIGNED', document));

  it('downloads the signed file once the document is complete', async () => {
    const signed = new TextEncoder().encode('%PDF-1.7\nsigned\n');
    const { provider, fetch } = setup(
      routes(
        'COMPLETED',
        () => new Response(signed, { headers: { 'content-type': 'application/pdf' } }),
      ),
    );
    await expect(provider.fetchSignedDocument(`v4:${PACK}:${DOC}`)).resolves.toEqual(signed);
    expect(fetch.mock.calls[1]![0]).toBe(
      `https://sandbox.leegality.com/api/v4/packs/download?downloadType=DOCUMENT&documentId=${DOC}&mode=stream`,
    );
  });

  it('follows a download link for the audit trail without the auth token', async () => {
    const trail = new TextEncoder().encode('%PDF-1.7\ntrail\n');
    const { provider, fetch } = setup((url) => {
      if (url.startsWith('https://sandbox-downloads.leegality.com/')) {
        return new Response(trail, { headers: { 'content-type': 'application/pdf' } });
      }
      if (url.includes('/v4/packs/download')) {
        return json({
          data: { url: 'https://sandbox-downloads.leegality.com/export/x', expiresAt: '' },
        });
      }
      return json(packDetails('SIGNED', 'COMPLETED'));
    });
    await expect(provider.fetchAuditTrail!(`v4:${PACK}:${DOC}`)).resolves.toEqual(trail);
    expect(fetch.mock.calls[1]![0]).toMatch(/downloadType=AUDIT_TRAIL/);
    expect(fetch.mock.calls[2]![1]).toEqual(
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });

  it('refuses before the document is complete', async () => {
    const { provider, fetch } = setup(routes('PACK_PENDING_COMPLETION', () => json({})));
    expect((await caught(provider.fetchSignedDocument(`v4:${PACK}:${DOC}`))).code).toBe(
      'INVALID_STATE',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a document the pack does not hold, and an unknown pack', async () => {
    const { provider } = setup(routes('COMPLETED', () => json({})));
    const error = await caught(provider.fetchSignedDocument(`v4:${PACK}:OTHER`));
    expect(error.details).toMatchObject({ reason: 'not_found' });
    const unknown = setup(() =>
      json({ code: 'LE_ERR_AP_001', errors: [{ code: 'LE_ERR_AP_001', message: 'no pack' }] }, 404),
    );
    const missing = await caught(unknown.provider.fetchSignedDocument(`v4:${PACK}:${DOC}`));
    expect(missing.details).toMatchObject({
      reason: 'not_found',
      providerCodes: ['LE_ERR_AP_001'],
    });
  });
});

describe('reading a workflow from its downloaded API payload', () => {
  const payload = {
    workflowId: WORKFLOW.workflowId,
    pack: { packName: '' },
    documents: [
      { uuid: WORKFLOW.documentUuid, subDocuments: [{ uuid: WORKFLOW.subDocumentUuid, file: '' }] },
    ],
    invitees: [
      { uuid: '00000000-0000-4000-8000-000000000000', type: 'reviewer' },
      {
        uuid: WORKFLOW.inviteeUuid,
        type: 'signer',
        inviteeDetails: [{ uuid: WORKFLOW.inviteeDetailsUuid }],
        combinations: [
          {
            uuid: WORKFLOW.combinationUuid,
            assignedDocuments: [{ uuid: WORKFLOW.assignedDocumentUuid }],
            combinationSettings: {
              esignTypes: {
                automatedEsign: { automatedSignConfig: { automatedSignPassword: 'x' } },
              },
            },
          },
        ],
      },
    ],
  };

  it('keeps the workflow id and the ids of the first document and signer only', () => {
    expect(leegalityV4WorkflowFromPayload(payload)).toEqual(WORKFLOW);
    expect(leegalityV4WorkflowFromPayload(JSON.stringify(payload))).toEqual(WORKFLOW);
  });

  it('leaves out ids the file does not have', () => {
    expect(leegalityV4WorkflowFromPayload({ workflowId: WORKFLOW.workflowId })).toEqual({
      workflowId: WORKFLOW.workflowId,
    });
  });

  it('refuses a file that is not a workflow payload', () => {
    expect(() => leegalityV4WorkflowFromPayload('{')).toThrow(/not JSON/);
    expect(() => leegalityV4WorkflowFromPayload([])).toThrow(/not a JSON object/);
    expect(() => leegalityV4WorkflowFromPayload({ documents: [] })).toThrow(/no workflowId/);
  });
});

describe('v4 references', () => {
  it('round-trips the pack and document ids', () => {
    expect(parseV4Ref(v4Ref(PACK, DOC))).toEqual({ packId: PACK, documentId: DOC });
    for (const ref of ['DOC123', 'v4:', 'v4:a', 'v4:a:b:c']) expect(parseV4Ref(ref)).toBeNull();
  });
});
