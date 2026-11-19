import { SignError } from '@codevibe/sign-core';

export const PROVIDER = 'Leegality';

export interface LeegalityMessage {
  code?: string;
  message?: string;
}

/** Every Leegality JSON response uses this wrapper; errors usually arrive with HTTP 200. */
export interface LeegalityEnvelope<T> {
  status?: number;
  messages?: LeegalityMessage[];
  data?: T;
}

export interface CreateResponseData {
  documentId?: string;
  irn?: string;
  invitees?: { name?: string; email?: string; phone?: string; signUrl?: string }[];
}

export interface StatusRequest {
  name?: string;
  signUrl?: string;
  signed?: boolean;
  rejected?: boolean;
  expired?: boolean;
}

export interface StatusResponseData {
  documentId?: string;
  auditTrail?: string;
  requests?: StatusRequest[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readEnvelope<T>(response: Response): Promise<LeegalityEnvelope<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SignError('PROVIDER_ERROR', `${PROVIDER} returned a response that is not JSON`, {
        provider: PROVIDER,
        reason: 'malformed_response',
        retryable: false,
      });
    }
    throw error;
  }
  if (!isRecord(body)) {
    throw new SignError('PROVIDER_ERROR', `${PROVIDER} returned an unexpected response`, {
      provider: PROVIDER,
      reason: 'malformed_response',
      retryable: false,
    });
  }
  return body as LeegalityEnvelope<T>;
}

/** Turns a `status: 0` wrapper into a `SignError` carrying Leegality's message codes. */
export function envelopeError(envelope: LeegalityEnvelope<unknown>): SignError {
  const messages = Array.isArray(envelope.messages) ? envelope.messages : [];
  const codes = messages.map((m) => m.code).filter((c): c is string => typeof c === 'string');
  const first = messages.find((m) => typeof m.message === 'string')?.message;
  const notFound = codes.includes('no.document.found');
  return new SignError(
    'PROVIDER_ERROR',
    first ? `${PROVIDER}: ${first}` : `${PROVIDER} rejected the request`,
    {
      provider: PROVIDER,
      reason: notFound ? 'not_found' : 'rejected',
      providerCodes: codes,
      retryable: false,
    },
  );
}
