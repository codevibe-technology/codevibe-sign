import { SignApiError } from './errors';
import type { ApiErrorCode } from './types';

export interface TransportOptions {
  /** Where the API is served, for example `https://sign.example.com`. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per attempt, including reading the body. Default 30 000. */
  timeoutMs?: number;
  /** Extra attempts for requests that are safe to repeat. Default 2. */
  retries?: number;
  /** Base of the exponential backoff between attempts. Default 500. */
  retryDelayMs?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /**
   * Sent as `Idempotency-Key` on POST requests. One is generated when left out, so a retried
   * POST never acts twice. Reuse your own key to make a call safe across process restarts.
   */
  idempotencyKey?: string;
}

export interface Call {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: Record<string, string | undefined>;
  json?: unknown;
  body?: { bytes: Uint8Array; contentType: string };
  headers?: Record<string, string>;
  options?: RequestOptions;
}

interface Received {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

const MAX_RETRY_AFTER_MS = 60_000;

export class Transport {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(options: TransportOptions) {
    if (!options.baseUrl) throw new TypeError('baseUrl is required');
    if (!options.fetch && typeof globalThis.fetch !== 'function') {
      throw new TypeError('No fetch available: pass one in the fetch option');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // Calling a bare global fetch detached from globalThis throws in some browsers.
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = Math.max(0, options.retries ?? 2);
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  async json<T>(call: Call): Promise<T> {
    const received = await this.send(call);
    try {
      return JSON.parse(new TextDecoder().decode(received.bytes)) as T;
    } catch (cause) {
      throw new SignApiError('BAD_RESPONSE', 'The server answered with invalid JSON', {
        status: received.status,
        ...requestIdOf(received.headers),
        cause,
      });
    }
  }

  async bytes(call: Call): Promise<Uint8Array> {
    return (await this.send(call)).bytes;
  }

  private async send(call: Call): Promise<Received> {
    const headers: Record<string, string> = { accept: 'application/json', ...call.headers };
    let body: BodyInit | undefined;
    if (call.json !== undefined) {
      body = JSON.stringify(call.json);
      headers['content-type'] = 'application/json';
    } else if (call.body) {
      body = call.body.bytes;
      headers['content-type'] = call.body.contentType;
    }
    if (call.method === 'POST') {
      headers['idempotency-key'] = call.options?.idempotencyKey ?? randomKey();
    }
    // The server replays a POST with the same key, so only PATCH is unsafe to repeat.
    const repeatable = call.method !== 'PATCH';
    const url = this.url(call);
    const signal = call.options?.signal;

    for (let attempt = 0; ; attempt++) {
      const canRetry = repeatable && attempt < this.retries;
      let received: Received;
      try {
        received = await this.attempt(url, { method: call.method, headers, body }, signal);
      } catch (err) {
        if (!(err instanceof SignApiError) || err.code === 'ABORTED' || !canRetry) throw err;
        await sleep(this.backoff(attempt), signal);
        continue;
      }
      if (received.status >= 200 && received.status < 300) return received;
      const error = toError(received);
      if (!canRetry || (received.status !== 429 && received.status < 500)) throw error;
      const wait = retryAfterMs(received.headers) ?? this.backoff(attempt);
      if (wait > MAX_RETRY_AFTER_MS) throw error;
      await sleep(wait, signal);
    }
  }

  private async attempt(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Received> {
    if (signal?.aborted) throw aborted(signal.reason);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.fetch(url, { ...init, signal: controller.signal });
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, bytes };
    } catch (cause) {
      if (timedOut) {
        throw new SignApiError('TIMEOUT', `No answer within ${this.timeoutMs} ms`, { cause });
      }
      if (signal?.aborted) throw aborted(cause);
      throw new SignApiError('NETWORK', 'Could not reach the signing server', { cause });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private url(call: Call): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(call.query ?? {})) {
      if (value !== undefined) query.set(key, value);
    }
    const search = query.toString();
    return `${this.baseUrl}${call.path}${search ? `?${search}` : ''}`;
  }

  private backoff(attempt: number): number {
    const base = this.retryDelayMs * 2 ** attempt;
    return base + Math.random() * this.retryDelayMs;
  }
}

/** Builds a path from literal parts and encoded parameters. */
export function path(strings: TemplateStringsArray, ...params: string[]): string {
  return strings.reduce(
    (out, part, i) => out + part + (i < params.length ? encodeURIComponent(params[i]!) : ''),
    '',
  );
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function aborted(cause: unknown): SignApiError {
  return new SignApiError('ABORTED', 'The request was aborted', { cause });
}

function requestIdOf(headers: Headers): { requestId?: string } {
  const id = headers.get('x-request-id');
  return id ? { requestId: id } : {};
}

function toError(received: Received): SignApiError {
  const init = { status: received.status, ...requestIdOf(received.headers) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(received.bytes));
  } catch {
    parsed = undefined;
  }
  const error = (parsed as { error?: unknown } | undefined)?.error;
  if (typeof error === 'object' && error !== null) {
    const { code, message, details } = error as Record<string, unknown>;
    if (typeof code === 'string' && typeof message === 'string') {
      return new SignApiError(code as ApiErrorCode, message, {
        ...init,
        ...(isRecord(details) ? { details } : {}),
      });
    }
  }
  return new SignApiError(codeFor(received.status), `The server answered ${received.status}`, init);
}

function codeFor(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'DOCUMENT_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  return status >= 500 ? 'INTERNAL' : 'VALIDATION';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted(signal.reason));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted(signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
