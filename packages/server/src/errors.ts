import { SignError, type SignErrorCode } from '@codevibe/sign-core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Codes the HTTP layer adds on top of the domain codes from core. */
export type HttpErrorCode = SignErrorCode | 'UNAUTHORIZED' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export interface ErrorBody {
  error: { code: HttpErrorCode; message: string; details?: Record<string, unknown> };
}

const STATUS: Record<HttpErrorCode, ContentfulStatusCode> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  TOKEN_INVALID: 401,
  OTP_INVALID: 401,
  OTP_EXPIRED: 401,
  FIELD_NOT_YOURS: 403,
  ENVELOPE_NOT_FOUND: 404,
  RECIPIENT_NOT_FOUND: 404,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  NOT_YOUR_TURN: 409,
  CONFLICT: 409,
  ENVELOPE_EXPIRED: 410,
  DOCUMENT_TOO_LARGE: 413,
  REQUIRED_FIELDS_MISSING: 422,
  INVALID_FIELD_VALUE: 422,
  DOCUMENT_INVALID: 422,
  OTP_LOCKED: 423,
  RATE_LIMITED: 429,
  SEAL_FAILED: 500,
  INTERNAL: 500,
  PROVIDER_ERROR: 502,
  WEBHOOK_INVALID: 502,
};

/** An error the HTTP layer raises for conditions core has no code for. */
export class HttpError extends Error {
  readonly code: HttpErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: HttpErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.details = details;
  }
}

/** Raised by a store when `expectedVersion` no longer matches. */
export class VersionConflictError extends Error {
  constructor(envelopeId: string) {
    super(`Envelope ${envelopeId} was changed by another request`);
    this.name = 'VersionConflictError';
  }
}

export function statusFor(code: HttpErrorCode): ContentfulStatusCode {
  return STATUS[code];
}

/** A `VALIDATION` error shaped like core's: `details.issues` lists `{ path, message }`. */
export function validation(message: string, details?: Record<string, unknown>): SignError {
  if (typeof details?.field === 'string') {
    return new SignError('VALIDATION', message, { issues: [{ path: details.field, message }] });
  }
  return new SignError('VALIDATION', message, details);
}

export interface Logger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  error: (message, meta) => console.error(message, meta ?? ''),
  warn: (message, meta) => console.warn(message, meta ?? ''),
};

export function toErrorBody(err: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (err instanceof SignError || err instanceof HttpError) {
    const error: ErrorBody['error'] = { code: err.code, message: err.message };
    if (err.details && Object.keys(err.details).length > 0) error.details = err.details;
    return { status: STATUS[err.code], body: { error } };
  }
  if (err instanceof VersionConflictError) {
    return {
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'The envelope changed, try again' } },
    };
  }
  if (err instanceof HTTPException) {
    const code: HttpErrorCode =
      err.status === 413
        ? 'DOCUMENT_TOO_LARGE'
        : err.status === 401
          ? 'UNAUTHORIZED'
          : 'VALIDATION';
    const status = err.status >= 500 ? 500 : (err.status as ContentfulStatusCode);
    return { status, body: { error: { code, message: err.message || 'Bad request' } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong' } } };
}

export function errorHandler(logger: Logger) {
  return (err: unknown, c: Context) => {
    const { status, body } = toErrorBody(err);
    if (status >= 500) {
      logger.error('request failed', {
        method: c.req.method,
        route: c.req.routePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (body.error.code === 'RATE_LIMITED' && err instanceof SignError) {
      const retryAfter = err.details?.retryAfterSeconds;
      if (typeof retryAfter === 'number') c.header('Retry-After', String(retryAfter));
    }
    return c.json(body, status);
  };
}
