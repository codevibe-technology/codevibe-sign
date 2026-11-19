import { describe, expect, it, vi } from 'vitest';
import { createSignClient, createSignerClient, SignApiError } from '.';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function mockFetch(...handlers: Handler[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)]!;
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const failure = (status: number, code: string) =>
  json(status, { error: { code, message: `${code} happened` } });

const envelope = { id: 'env_1', status: 'draft' };

function client(
  fetch: typeof globalThis.fetch,
  extra: { retries?: number; timeoutMs?: number } = {},
) {
  return createSignClient({
    baseUrl: 'https://sign.example.com/',
    apiKey: 'key',
    fetch,
    retryDelayMs: 1,
    ...extra,
  });
}

describe('requests', () => {
  it('joins the base URL, encodes path parts and sends the API key', async () => {
    const { fn, calls } = mockFetch(() => json(200, envelope));
    await client(fn).envelopes.get('a/b c');
    expect(calls[0]?.url).toBe('https://sign.example.com/v1/envelopes/a%2Fb%20c');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer key');
  });

  it('asks for a document version in the query string', async () => {
    const { fn, calls } = mockFetch(() => new Response(new Uint8Array([37, 80, 68, 70])));
    const bytes = await client(fn).envelopes.downloadDocument('e', 'd', { version: 'sealed' });
    expect(calls[0]?.url).toBe(
      'https://sign.example.com/v1/envelopes/e/documents/d?version=sealed',
    );
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
  });

  it('adds consent to a submit and keeps only fieldId and value', async () => {
    const { fn, calls } = mockFetch(() => json(200, { envelopeStatus: 'completed' }));
    const signer = createSignerClient({ baseUrl: 'https://s.example', token: 'tok', fetch: fn });
    const value = { fieldId: 'f1', value: 'Asha', extra: 1 } as { fieldId: string; value: string };
    await signer.submit([value]);
    expect(calls[0]?.url).toBe('https://s.example/v1/sign/tok/submit');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      consent: true,
      values: [{ fieldId: 'f1', value: 'Asha' }],
    });
  });

  it('checks required options up front', () => {
    expect(() => createSignClient({ baseUrl: '', apiKey: 'k' })).toThrow(/baseUrl/);
    expect(() => createSignClient({ baseUrl: 'https://x', apiKey: '' })).toThrow(/apiKey/);
    expect(() => createSignerClient({ baseUrl: 'https://x', token: '' })).toThrow(/token/);
  });
});

describe('errors', () => {
  it('falls back to a code from the status when the body is not the API error shape', async () => {
    const { fn } = mockFetch(() => new Response('<html>Bad gateway</html>', { status: 404 }));
    await expect(client(fn).envelopes.get('e')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('reports a success response that is not JSON as BAD_RESPONSE', async () => {
    const { fn } = mockFetch(() => new Response('not json', { status: 200 }));
    await expect(client(fn).envelopes.get('e')).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      status: 200,
    });
  });

  it('exposes retryAfterSeconds from rate limit details', async () => {
    const { fn } = mockFetch(() =>
      json(429, {
        error: { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfterSeconds: 120 } },
      }),
    );
    const err = (await client(fn)
      .envelopes.get('e')
      .catch((e: unknown) => e)) as SignApiError;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfterSeconds).toBe(120);
  });
});

describe('retries', () => {
  it('retries GET on 5xx and 429 and then succeeds', async () => {
    const { fn, calls } = mockFetch(
      () => failure(503, 'INTERNAL'),
      () => failure(429, 'RATE_LIMITED'),
      () => json(200, envelope),
    );
    await expect(client(fn).envelopes.get('e')).resolves.toEqual(envelope);
    expect(calls).toHaveLength(3);
  });

  it('gives up after the configured number of retries', async () => {
    const { fn, calls } = mockFetch(() => failure(500, 'INTERNAL'));
    await expect(client(fn, { retries: 1 }).envelopes.get('e')).rejects.toMatchObject({
      code: 'INTERNAL',
      status: 500,
    });
    expect(calls).toHaveLength(2);
  });

  it('does not retry client errors', async () => {
    const { fn, calls } = mockFetch(() => failure(422, 'REQUIRED_FIELDS_MISSING'));
    await expect(client(fn).envelopes.send('e')).rejects.toMatchObject({
      code: 'REQUIRED_FIELDS_MISSING',
    });
    expect(calls).toHaveLength(1);
  });

  it('never retries PATCH, which has no idempotency key', async () => {
    const { fn, calls } = mockFetch(() => failure(503, 'INTERNAL'));
    await expect(client(fn).envelopes.update('e', { title: 'x' })).rejects.toMatchObject({
      status: 503,
    });
    await expect(client(fn).envelopes.update('e', { title: 'x' })).rejects.toBeInstanceOf(
      SignApiError,
    );
    expect(calls).toHaveLength(2);
  });

  it('retries a POST on network errors with the same Idempotency-Key and body', async () => {
    const { fn, calls } = mockFetch(
      () => {
        throw new TypeError('fetch failed');
      },
      () => json(200, envelope),
    );
    await client(fn).envelopes.void('e', 'Mistake');
    expect(calls).toHaveLength(2);
    const key = (i: number) => new Headers(calls[i]?.init.headers).get('idempotency-key');
    expect(key(0)).toBeTruthy();
    expect(key(1)).toBe(key(0));
    expect(calls[1]?.init.body).toBe(calls[0]?.init.body);
  });

  it('uses the caller-supplied Idempotency-Key', async () => {
    const { fn, calls } = mockFetch(() => json(200, envelope));
    await client(fn).envelopes.send('e', { idempotencyKey: 'send-e-once' });
    expect(new Headers(calls[0]?.init.headers).get('idempotency-key')).toBe('send-e-once');
  });

  it('reports NETWORK once retries run out', async () => {
    const { fn, calls } = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const err = (await client(fn, { retries: 2 })
      .envelopes.get('e')
      .catch((e) => e)) as SignApiError;
    expect(err).toMatchObject({ code: 'NETWORK', status: 0 });
    expect(err.cause).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(3);
  });

  it('waits for Retry-After before trying again', async () => {
    vi.useFakeTimers();
    try {
      const { fn, calls } = mockFetch(
        () => json(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, { 'retry-after': '2' }),
        () => json(200, envelope),
      );
      const pending = client(fn).envelopes.get('e');
      await vi.advanceTimersByTimeAsync(1_900);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(200);
      await expect(pending).resolves.toEqual(envelope);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait out a Retry-After longer than a minute', async () => {
    const { fn, calls } = mockFetch(() =>
      json(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, { 'retry-after': '3600' }),
    );
    await expect(client(fn).envelopes.get('e')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toHaveLength(1);
  });
});

describe('timeouts and cancelling', () => {
  const hang: Handler = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    });

  it('times out each attempt and retries idempotent requests', async () => {
    const { fn, calls } = mockFetch(hang, () => json(200, envelope));
    await expect(client(fn, { timeoutMs: 20 }).envelopes.get('e')).resolves.toEqual(envelope);
    expect(calls).toHaveLength(2);
  });

  it('reports TIMEOUT when every attempt times out', async () => {
    const { fn } = mockFetch(hang);
    await expect(
      client(fn, { timeoutMs: 10, retries: 1 }).envelopes.get('e'),
    ).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
  });

  it('stops at once when the caller aborts, without retrying', async () => {
    const { fn, calls } = mockFetch(hang);
    const controller = new AbortController();
    const pending = client(fn).envelopes.get('e', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(calls).toHaveLength(1);
  });

  it('does not start a request with an already aborted signal', async () => {
    const { fn, calls } = mockFetch(() => json(200, envelope));
    const signal = AbortSignal.abort();
    await expect(client(fn).envelopes.get('e', { signal })).rejects.toMatchObject({
      code: 'ABORTED',
    });
    expect(calls).toHaveLength(0);
  });
});
