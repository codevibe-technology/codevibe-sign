import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/errors';

const state = vi.hoisted(() => ({
  verified: [] as number[],
  lookups: [] as string[],
  valid: true,
  fail: null as Error | null,
}));

vi.mock('@/server/db', () => ({ db: () => ({}) }));
vi.mock('@/server/env', () => ({ env: () => ({ TRUST_PROXY: true }) }));
vi.mock('@/server/pdf', () => ({
  verifyUpload: async (bytes: Uint8Array, scope: string) => {
    if (state.fail) throw state.fail;
    state.verified.push(bytes.byteLength);
    expect(scope).toBe('install');
    return {
      valid: state.valid,
      summary: 'ok',
      reason: null,
      signer: null,
      signedAt: null,
      sha256: 'abc',
    };
  },
}));
vi.mock('@/server/public-verify', () => ({
  sealedEvidence: async (_sql: unknown, sha256: string) => {
    state.lookups.push(sha256);
    return { title: 'Offer letter' };
  },
}));

const { POST } = await import('./route');

let address = 0;
function post(body: FormData | string, ip = `198.51.100.${++address}`) {
  return POST(
    new Request('http://localhost/api/verify', {
      method: 'POST',
      body,
      headers: { 'x-forwarded-for': ip },
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
    state.lookups = [];
    state.valid = true;
    state.fail = null;
  });

  it('checks the file and returns the evidence for a valid seal', async () => {
    const response = await post(form());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: expect.objectContaining({
        valid: true,
        fileName: 'offer.pdf',
        evidence: { title: 'Offer letter' },
      }),
    });
    expect(state.lookups).toEqual(['abc']);
  });

  it('does not look up an envelope when the seal is not valid', async () => {
    state.valid = false;
    const body = (await (await post(form())).json()) as { data: { evidence: unknown } };
    expect(body.data.evidence).toBeNull();
    expect(state.lookups).toEqual([]);
  });

  it('asks for a file when none was sent, and passes on problems with the file', async () => {
    expect((await post('nothing')).status).toBe(400);
    state.fail = new AppError('VALIDATION', 'That file is not a PDF.', 'file');
    const response = await post(form());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'That file is not a PDF.' });
  });

  it('limits how often one address can check', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await post(form(), '203.0.113.7')).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
