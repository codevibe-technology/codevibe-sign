import type {
  AuthMethod,
  EnvelopeStatus,
  Field,
  FieldValue,
  RecipientRole,
  RecipientStatus,
} from '@codevibe_technology/sign-core';
import type { BrandFont } from './brand';

/** `GET /api/v1/sign/link`: what the signer may see. */
export interface SignerView {
  workspaceId: string;
  envelope: {
    id: string;
    title: string;
    message: string | null;
    /** For a revised envelope: what changed since the version that was declined. */
    changeNote?: string | null;
    status: EnvelopeStatus;
    expiresAt: string | null;
  };
  recipient: {
    id: string;
    name: string;
    email: string | null;
    role: RecipientRole;
    status: RecipientStatus;
    auth: AuthMethod;
  };
  documents: { id: string; name: string; pageCount: number }[];
  fields: Field[];
  values: FieldValue[];
  otpRequired: boolean;
  authenticated: boolean;
  canAct: boolean;
  /** IANA zone the signing date is printed in on the document. */
  timeZone: string;
}

/** `GET /api/v1/sign/receipt`: where things stand after signing. */
export interface SigningReceipt {
  workspaceId: string;
  envelope: { id: string; title: string; status: EnvelopeStatus; completedAt: string | null };
  recipient: { id: string; name: string; role: RecipientRole; status: RecipientStatus };
  waitingFor: number;
  documents: { id: string; name: string; sealed: boolean }[];
}

/** `GET /brand/<workspaceId>/signing`: the header of the signing page. */
export interface SigningBrand {
  name: string;
  logoUrl: string | null;
  brandColor: string;
  font: BrandFont;
  showBadge: boolean;
}

export const isWorkspaceId = (value: unknown): value is string =>
  typeof value === 'string' && /^ws_[0-9a-f]{20}$/.test(value);

/** Why the signing page cannot show a document. The first six come from the link itself. */
export const END_STATES = [
  'invalid',
  'expired',
  'voided',
  'declined',
  'completed',
  'signed',
  'not_your_turn',
  'declined_by_you',
] as const;
export type EndState = (typeof END_STATES)[number];

export const isEndState = (value: unknown): value is EndState =>
  typeof value === 'string' && (END_STATES as readonly string[]).includes(value);

/** What each end state says. `company` is who sent the document, when known. */
export function endStateCopy(state: EndState, company: string | null) {
  const sender = company ?? 'the sender';
  const copy: Record<EndState, { title: string; body: string }> = {
    invalid: {
      title: 'This link does not work',
      body: `It may be incomplete or replaced by a newer email. Open the latest email about this document, or ask ${sender} to send it again.`,
    },
    expired: {
      title: 'This link has expired',
      body: `Signing links work for a limited time. Ask ${sender} to send you a new one.`,
    },
    voided: {
      title: 'This request was withdrawn',
      body: `${capitalise(sender)} cancelled it, so there is nothing for you to sign. You do not need to do anything.`,
    },
    declined: {
      title: 'This document was declined',
      body: 'Someone declined to sign, so the request was closed. You do not need to do anything.',
    },
    completed: {
      title: 'This document is complete',
      body: 'Everyone has signed. The signed copy was emailed to you; keep it for your records.',
    },
    signed: {
      title: 'You have already signed',
      body: 'Thank you, your part is done. When everyone has signed, we will email you the signed copy.',
    },
    not_your_turn: {
      title: 'It is not your turn yet',
      body: 'Someone else needs to sign before you. We will email you when it is your turn.',
    },
    declined_by_you: {
      title: 'You declined to sign',
      body: `We have let ${sender} know, with your reason. You can close this page.`,
    },
  };
  return copy[state];
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A refusal from the signing API. */
export class SigningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SigningError';
  }
}

const NETWORK = 'We could not reach the server. Check your connection and try again in a moment.';

/** Calls the signing API from the signing page; the link and session cookies go along. */
export async function signFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`/api/v1/sign/${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new SigningError('NETWORK', NETWORK, 0);
  }
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  };
  const code = body.error?.code ?? 'HTTP';
  const message =
    res.status === 429
      ? 'Too many tries in a short time. Wait a minute, then try again.'
      : res.status >= 500
        ? 'Something went wrong on our side. Try again in a moment.'
        : (body.error?.message ?? 'The request was refused.');
  throw new SigningError(code, message, res.status, body.error?.details ?? {});
}

export const linkDocumentUrl = (documentId: string) =>
  `/api/v1/sign/link/documents/${encodeURIComponent(documentId)}`;

export const receiptDocumentUrl = (documentId: string) =>
  `/api/v1/sign/receipt/documents/${encodeURIComponent(documentId)}`;

/** The message for a refused one-time code, saying what to do next. */
export function otpProblem(error: unknown): string {
  if (!(error instanceof SigningError)) return NETWORK;
  if (error.code === 'OTP_INVALID') {
    const left = error.details.attemptsLeft;
    return typeof left === 'number'
      ? `That code is not right. ${left === 1 ? '1 try' : `${left} tries`} left.`
      : 'That code is not right. Check the latest email and try again.';
  }
  if (error.code === 'OTP_EXPIRED') return 'That code has expired. Send yourself a new one.';
  if (error.code === 'OTP_LOCKED') {
    return error.details.reason === 'too_many_codes'
      ? 'No more codes can be sent for this document. Ask the sender to send it again.'
      : 'Too many wrong codes. Send yourself a new one.';
  }
  return error.message;
}

/**
 * `05 Nov 2026`: the day `at` falls on in `timeZone`, written the way the sealed document
 * prints a date of signing.
 */
export function signingDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
}
