import { afterEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  TURNSTILE_SITE_KEY: undefined as string | undefined,
  TURNSTILE_SECRET_KEY: undefined as string | undefined,
  TRUST_PROXY: true,
}));
vi.mock('./env', () => ({ env: () => config }));

const { checkHuman, requireHuman, SITEVERIFY_URL, turnstileSiteKey, verifyTurnstile } =
  await import('./human-check');

const answer = (body: unknown, status = 200) => Response.json(body, { status });

function fakeFetch(...replies: (Response | Error)[]) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(init?.body as URLSearchParams) });
    const next = replies.shift() ?? new Error('no more replies');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

afterEach(() => {
  config.TURNSTILE_SITE_KEY = undefined;
  config.TURNSTILE_SECRET_KEY = undefined;
});

describe('verifyTurnstile', () => {
  it('passes a token Cloudflare accepts, sending the secret, address and idempotency key', async () => {
    const { fetch, calls } = fakeFetch(answer({ success: true, 'error-codes': [] }));
    const result = await verifyTurnstile({
      secret: 'secret-key',
      token: ' token-1 ',
      remoteIp: '203.0.113.7',
      idempotencyKey: 'key-1',
      fetch,
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(SITEVERIFY_URL);
    expect(Object.fromEntries(calls[0]!.body)).toEqual({
      secret: 'secret-key',
      response: 'token-1',
      remoteip: '203.0.113.7',
      idempotency_key: 'key-1',
    });
  });

  it('refuses a token Cloudflare turns down, without asking again', async () => {
    const { fetch, calls } = fakeFetch(
      answer({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );
    expect(await verifyTurnstile({ secret: 's', token: 't', fetch })).toEqual({
      ok: false,
      reason: 'rejected',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses a missing or oversized token without calling Cloudflare', async () => {
    const { fetch, calls } = fakeFetch();
    expect(await verifyTurnstile({ secret: 's', token: undefined, fetch })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(await verifyTurnstile({ secret: 's', token: '   ', fetch })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(await verifyTurnstile({ secret: 's', token: 'x'.repeat(2049), fetch })).toEqual({
      ok: false,
      reason: 'rejected',
    });
    expect(calls).toHaveLength(0);
  });

  it('asks once more with the same key after a timeout, then passes', async () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    const { fetch, calls } = fakeFetch(timeout, answer({ success: true }));
    expect(await verifyTurnstile({ secret: 's', token: 't', fetch })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.get('idempotency_key')).toBe(calls[1]!.body.get('idempotency_key'));
    expect(calls[0]!.body.get('idempotency_key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails closed when Cloudflare does not answer or answers with an error', async () => {
    const down = fakeFetch(new Error('network'), new Error('network'));
    expect(await verifyTurnstile({ secret: 's', token: 't', fetch: down.fetch })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const broken = fakeFetch(
      answer({}, 502),
      answer({ success: false, 'error-codes': ['internal-error'] }),
    );
    expect(await verifyTurnstile({ secret: 's', token: 't', fetch: broken.fetch })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const garbled = fakeFetch(new Response('not json'), new Response('<html>'));
    expect(await verifyTurnstile({ secret: 's', token: 't', fetch: garbled.fetch })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('stops the request on a slow answer', async () => {
    const hang: typeof globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    const started = Date.now();
    expect(await verifyTurnstile({ secret: 's', token: 't', fetch: hang, timeoutMs: 20 })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('treats a refused secret as the install being misconfigured, and logs no token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fetch } = fakeFetch(
      answer({ success: false, 'error-codes': ['invalid-input-secret'] }),
    );
    expect(await verifyTurnstile({ secret: 'real-secret', token: 'tok', fetch })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('TURNSTILE_SECRET_KEY');
    expect(logged).not.toContain('real-secret');
    expect(logged).not.toContain('tok');
  });
});

describe('checkHuman', () => {
  it('lets everything through when the check is off', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(turnstileSiteKey()).toBeNull();
    expect(await checkHuman(null, new Headers())).toEqual({ ok: true });
    await expect(requireHuman(undefined, new Headers())).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('needs a token once both keys are set, and names what to do', async () => {
    config.TURNSTILE_SITE_KEY = 'site-key';
    config.TURNSTILE_SECRET_KEY = 'secret-key';
    expect(turnstileSiteKey()).toBe('site-key');
    expect(await checkHuman(null, new Headers())).toEqual({ ok: false, reason: 'missing' });
    await expect(requireHuman('', new Headers())).rejects.toMatchObject({
      code: 'HUMAN_CHECK',
      message: expect.stringContaining('Reload the page'),
    });
  });

  it('sends the address the proxy reports', async () => {
    config.TURNSTILE_SITE_KEY = 'site-key';
    config.TURNSTILE_SECRET_KEY = 'secret-key';
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer({ success: true }));
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' });
    expect(await checkHuman('tok', headers)).toEqual({ ok: true });
    const body = new URLSearchParams(fetch.mock.calls[0]![1]!.body as URLSearchParams);
    expect(body.get('remoteip')).toBe('203.0.113.9');
    expect(body.get('secret')).toBe('secret-key');
  });
});
