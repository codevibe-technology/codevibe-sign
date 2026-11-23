import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: () => async () => [{ ok: 1 }] }));

const { GET } = await import('./route');

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health', () => {
  it('names the mode of the billing keys and never a key', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_abc123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'razorpay-secret-value');
    vi.stubEnv('LEEGALITY_API_KEY', 'leegality-secret-value');
    vi.stubEnv('LEEGALITY_PRIVATE_SALT', 'salt-secret-value');
    vi.stubEnv('LEEGALITY_WORKFLOW_ID', 'wf_1');
    const response = await GET();
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      ok: true,
      billing: { razorpay: 'test', leegality: 'sandbox', live: false, problems: [] },
    });
    expect(body).not.toMatch(/secret-value|rzp_test_abc123|wf_1/);
  });

  it('stays healthy and gives only a code when a billing setting is malformed', async () => {
    vi.stubEnv('ESIGN_MARKUP_INR', 'ten');
    vi.stubEnv('ESIGN_PROVIDER_COST_INR', 'lots');
    const response = await GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as { ok: boolean; billing: { problems: string[] } };
    expect(body.ok).toBe(true);
    expect(body.billing.problems).toEqual(['settings_invalid']);
    expect(text).not.toMatch(/ESIGN|MARKUP|COST|INR/);
  });

  it('gives a code, not a sentence, for test keys on a live install', async () => {
    vi.stubEnv('BILLING_LIVE', 'true');
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_abc123');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'razorpay-secret-value');
    const body = (await (await GET()).json()) as { billing: { problems: string[] } };
    expect(body.billing.problems).toEqual(['test_payment_key_while_live']);
  });
});
