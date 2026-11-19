import { SignError } from '@codevibe/sign-core';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch: FetchLike;
  timeoutMs: number;
  provider: string;
}

/**
 * Sends a request and reads its body under one hard timeout. Transport failures and non-2xx
 * statuses become `SignError`s; `read` only ever sees a 2xx response.
 */
export async function request<T>(
  url: string,
  init: RequestInit,
  options: HttpOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await options.fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw transportError(controller.signal.aborted, options);
    }
    if (!response.ok) throw statusError(response.status, options.provider);
    try {
      return await read(response);
    } catch (error) {
      if (error instanceof SignError) throw error;
      throw transportError(controller.signal.aborted, options);
    }
  } finally {
    clearTimeout(timer);
  }
}

function transportError(timedOut: boolean, options: HttpOptions): SignError {
  return new SignError(
    'PROVIDER_ERROR',
    timedOut
      ? `${options.provider} did not respond within ${options.timeoutMs} ms`
      : `Could not reach ${options.provider}`,
    { provider: options.provider, reason: timedOut ? 'timeout' : 'network', retryable: true },
  );
}

function statusError(status: number, provider: string): SignError {
  if (status === 429) {
    return new SignError('RATE_LIMITED', `${provider} is rate limiting requests`, {
      provider,
      status,
      retryable: true,
    });
  }
  if (status === 401 || status === 403) {
    return new SignError(
      'PROVIDER_ERROR',
      `${provider} rejected the credentials; check the API key and environment`,
      { provider, status, reason: 'unauthorized', retryable: false },
    );
  }
  const retryable = status >= 500;
  return new SignError('PROVIDER_ERROR', `${provider} returned HTTP ${status}`, {
    provider,
    status,
    reason: retryable ? 'unavailable' : 'rejected',
    retryable,
  });
}
