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

  it('stays healthy and names the variable when a billing setting is malformed', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'not-a-key');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'razorpay-secret-value');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; billing: { problems: string[] } };
    expect(body.ok).toBe(true);
    expect(body.billing.problems).toEqual([
      'RAZORPAY_KEY_ID must look like rzp_test_... or rzp_live_...',
    ]);
  });
});
