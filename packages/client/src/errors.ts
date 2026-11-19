import type { ApiErrorCode, ClientErrorCode } from './types';

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Any failed call. `status` is 0 when no response arrived; `code` is then one of the
 * client's own codes (`NETWORK`, `TIMEOUT`, `ABORTED`).
 */
export class SignApiError extends Error {
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** The `X-Request-Id` response header, when the server or a proxy in front of it sets one. */
  readonly requestId?: string;

  constructor(
    code: ApiErrorCode | ClientErrorCode,
    message: string,
    init: {
      status?: number;
      details?: Record<string, unknown>;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'SignApiError';
    this.code = code;
    this.status = init.status ?? 0;
    if (init.details !== undefined) this.details = init.details;
    if (init.requestId !== undefined) this.requestId = init.requestId;
  }

  /** Field-level problems of a `VALIDATION` error, such as `recipients[1].email`. */
  get issues(): ValidationIssue[] {
    const issues = this.details?.issues;
    return Array.isArray(issues) ? (issues as ValidationIssue[]) : [];
  }

  /** Seconds the server asked to wait before trying again, for `RATE_LIMITED`. */
  get retryAfterSeconds(): number | undefined {
    const value = this.details?.retryAfterSeconds;
    return typeof value === 'number' ? value : undefined;
  }
}

export function isSignApiError(err: unknown): err is SignApiError {
  return err instanceof SignApiError;
}
