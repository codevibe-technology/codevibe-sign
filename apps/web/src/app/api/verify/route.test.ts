import { SignError } from '@codevibe_technology/sign-core';
import type { PublicVerification } from '@codevibe_technology/sign-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answer = (overrides: Partial<PublicVerification> = {}): PublicVerification => ({
  valid: true,
  reason: null,
  sha256: 'abc',
  checks: {
    sealed: true,
    singleSignature: true,
    intact: true,
    coversWholeDocument: true,
    trustedCertificate: true,
  },
  signer: { commonName: 'Codevibe Sign Seal', organization: 'Codevibe' },
  signedAt: '2026-11-20T10:05:01.000Z',
  certificateSha256: 'c'.repeat(64),
  seal: 'operator',
  earlierSignatures: [],
  envelope: {
    id: 'env_1',
    title: 'Offer letter',
    documentId: 'doc_1',
    documentName: 'offer.pdf',
    sentAt: '2026-11-20T09:01:00.000Z',
    completedAt: '2026-11-20T10:05:00.000Z',
    recipients: [],
    events: [],
    chain: { valid: true, head: 'h', events: 0 },
  },
  ...overrides,
});

const state = vi.hoisted(() => ({
  verified: [] as number[],
  answer: null as unknown,
  fail: null as Error | null,
}));

vi.mock('@/server/env', () => ({ env: () => ({ TRUST_PROXY: true }) }));
vi.mock('@/server/sign/server', () => ({
  signServer: () => ({
    verifyPdf: async (bytes: Uint8Array) => {
      if (state.fail) throw state.fail;
      state.verified.push(bytes.byteLength);
      return state.answer;
    },
  }),
}));

const { POST } = await import('./route');

let address = 0;
function post(
  body: FormData | string,
  ip = `198.51.100.${++address}`,
  length: string | null = '2048',
) {
  return POST(
    new Request('http://localhost/api/verify', {
      method: 'POST',
      body,
      headers: { 'x-forwarded-for': ip, ...(length === null ? {} : { 'content-length': length }) },
    }),
  );
}

const form = () => {
  const data = new FormData();
  data.set('file', new File(['%PDF-1.7 sealed'], 'offer.pdf', { type: 'application/pdf' }));
  return data;
};

describe('POST /api/verify', () => {
  beforeEach(() => {
    state.verified = [];
    state.answer = answer();
    state.fail = null;
  });

  it('gives the sign server the file and shows its answer in the page’s words', async () => {
    const response = await post(form());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        valid: true,
        summary:
          'Authentic. This is exactly the document sealed by Codevibe Sign on this site, unchanged since.',
        reason: null,
        signer: 'Codevibe Sign Seal, Codevibe',
        signedAt: '2026-11-20T10:05:01.000Z',
        sha256: 'abc',
        seal: 'operator',
        earlier: [],
        fileName: 'offer.pdf',
        evidence: {
          title: 'Offer letter',
          documentName: 'offer.pdf',
          sentAt: '2026-11-20T09:01:00.000Z',
          completedAt: '2026-11-20T10:05:00.000Z',
          recipients: [],
          events: [],
          chain: { valid: true, head: 'h', events: 0 },
        },
      },
    });
    expect(state.verified).toEqual([15]);
  });

  it('explains a file that is not a valid sealed document', async () => {
    const cases: [PublicVerification['reason'], RegExp][] = [
      ['not_sealed', /carries no seal/],
      ['signature_invalid', /seal is broken/],
      ['not_whole_document', /added to the file after it was sealed/],
      ['untrusted_signer', /different certificate, not by Codevibe Sign on this site/],
      ['unreadable', /could not be read as a PDF/],
    ];
    for (const [reason, summary] of cases) {
      state.answer = answer({ valid: false, reason, envelope: null, signer: null });
      const body = (await (await post(form())).json()) as {
        data: { valid: boolean; summary: string; evidence: unknown; signer: unknown };
      };
      expect(body.data).toMatchObject({ valid: false, evidence: null, signer: null });
      expect(body.data.summary).toMatch(summary);
    }
  });

  it('asks for a file when none was sent, and passes on problems with the file', async () => {
    expect((await post('nothing')).status).toBe(400);
    const cases: [SignError, number, RegExp][] = [
      [new SignError('DOCUMENT_INVALID', 'The file is not a PDF'), 400, /not a PDF/],
      [new SignError('DOCUMENT_TOO_LARGE', 'Too large'), 400, /larger than 20 MB/],
      [new SignError('RATE_LIMITED', 'Busy'), 429, /Try again in a moment/],
    ];
    for (const [fail, status, message] of cases) {
      state.fail = fail;
      const response = await post(form());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, error: expect.stringMatching(message) });
    }
    state.fail = new Error('connect ECONNREFUSED 10.0.0.5:5432');
    const broken = await post(form());
    expect(broken.status).toBe(500);
    expect(JSON.stringify(await broken.json())).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  it('wants to know the size before it reads anything', async () => {
    expect((await post(form(), undefined, null)).status).toBe(411);
    expect((await post(form(), undefined, String(64 * 1024 * 1024))).status).toBe(413);
    expect(state.verified).toEqual([]);
  });

  it('limits how often one address can check', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await post(form(), '203.0.113.7')).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
