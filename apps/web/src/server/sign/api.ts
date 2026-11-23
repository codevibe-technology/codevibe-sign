import 'server-only';
import type { AuditEvent } from '@codevibe_technology/sign-core';
import type { ApiEnvelope as Envelope, Principal } from '@codevibe_technology/sign-server';
import type { EnvelopePage } from '@/lib/envelopes';
import { AppError, type AppErrorCode } from '../errors';
import { signRequest } from './client';

export interface CertificateView {
  envelopeId: string;
  title: string;
  status: Envelope['status'];
  completedAt: string | null;
  auditHead: string | null;
  chainValid: boolean;
  documents: { id: string; name: string; sha256: string; sealedSha256: string | null }[];
  recipients: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    auth: string;
    status: string;
    actions: { action: string; at: string; ip: string | null; userAgent: string | null }[];
  }[];
}

export interface SealCheck {
  documentId: string;
  valid: boolean;
  reason: string | null;
  signer: { commonName?: string; organization?: string } | null;
  signedAt: string | null;
  certificateSha256: string | null;
  sha256: string;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: { issues?: { path?: string; message?: string }[] };
  };
}

const CODES: Record<number, AppErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'CONFLICT',
  413: 'VALIDATION',
  422: 'VALIDATION',
  423: 'CONFLICT',
  429: 'CONFLICT',
};

/** The API's error as an `AppError`, keeping its message and the field it points at. */
export async function apiError(res: Response): Promise<AppError> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  const code = CODES[res.status];
  if (!code) {
    console.error('sign api failed', res.status, body.error?.code);
    return new AppError(
      'CONFLICT',
      'The signing service could not finish that. Try again in a moment.',
    );
  }
  if (body.error?.code === 'PLAN_LIMIT') {
    return new AppError('PLAN_LIMIT', body.error.message ?? 'The plan limit was reached.');
  }
  const issue = body.error?.details?.issues?.[0];
  const message =
    res.status === 404
      ? 'That envelope no longer exists in this workspace.'
      : (issue?.message ?? body.error?.message ?? 'The request was refused.');
  return new AppError(code, message, issue?.path);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

/** The sign API, called in-process as `principal`. Failures become `AppError`s. */
export function signApi(principal: Principal) {
  const call = (path: `/v1/${string}`, init?: RequestInit) => signRequest(principal, path, init);
  const envelope = (id: string) => `/v1/envelopes/${encodeURIComponent(id)}` as const;
  return {
    list: async (query: {
      status?: readonly string[];
      q?: string;
      cursor?: string;
      limit?: number;
    }) => {
      const params = new URLSearchParams();
      if (query.status?.length) params.set('status', query.status.join(','));
      if (query.q) params.set('q', query.q);
      if (query.cursor) params.set('cursor', query.cursor);
      params.set('limit', String(query.limit ?? 25));
      return json<EnvelopePage>(await call(`/v1/envelopes?${params}`));
    },
    get: async (id: string) => json<Envelope>(await call(envelope(id))),
    create: async (form: FormData) =>
      json<Envelope>(await call('/v1/envelopes', { method: 'POST', body: form })),
    update: async (id: string, body: unknown) =>
      json<Envelope>(await call(envelope(id), jsonInit('PATCH', body))),
    send: async (id: string) =>
      json<Envelope>(await call(`${envelope(id)}/send`, jsonInit('POST'))),
    void: async (id: string, reason: string) =>
      json<Envelope>(await call(`${envelope(id)}/void`, jsonInit('POST', { reason }))),
    remind: async (id: string, recipientId?: string) =>
      json<Envelope>(
        await call(`${envelope(id)}/remind`, jsonInit('POST', recipientId ? { recipientId } : {})),
      ),
    shareLink: async (id: string, recipientId: string) =>
      json<{ recipientId: string; url: string }>(
        await call(
          `${envelope(id)}/recipients/${encodeURIComponent(recipientId)}/link`,
          jsonInit('POST'),
        ),
      ),
    correctRecipient: async (
      id: string,
      recipientId: string,
      body: { name?: string; email?: string; phone?: string; resend?: boolean },
    ) =>
      json<Envelope>(
        await call(
          `${envelope(id)}/recipients/${encodeURIComponent(recipientId)}`,
          jsonInit('PATCH', body),
        ),
      ),
    recall: async (id: string, note?: string) =>
      json<{ draft: Envelope; recalled: Envelope }>(
        await call(`${envelope(id)}/recall`, jsonInit('POST', note ? { note } : {})),
      ),
    revise: async (id: string) =>
      json<{ draft: Envelope; declined: Envelope }>(
        await call(`${envelope(id)}/revise`, jsonInit('POST')),
      ),
    replaceDocument: async (id: string, documentId: string, form: FormData) =>
      json<{ envelope: Envelope; movedFields: string[] }>(
        await call(`${envelope(id)}/documents/${encodeURIComponent(documentId)}`, {
          method: 'PUT',
          body: form,
        }),
      ),
    events: async (id: string) =>
      json<{ events: AuditEvent[]; chainValid: boolean }>(await call(`${envelope(id)}/events`)),
    auditTrail: (id: string) => call(`${envelope(id)}/audit-trail`),
    certificate: async (id: string) =>
      json<CertificateView>(await call(`${envelope(id)}/certificate`)),
    verification: async (id: string, documentId: string) =>
      json<SealCheck>(
        await call(`${envelope(id)}/documents/${encodeURIComponent(documentId)}/verification`),
      ),
    document: (
      id: string,
      documentId: string,
      version?: 'original' | 'sealed' | 'certificate' | 'provider-audit-trail',
    ) =>
      call(
        `${envelope(id)}/documents/${encodeURIComponent(documentId)}${version ? `?version=${version}` : ''}`,
      ),
  };
}

export type SignApi = ReturnType<typeof signApi>;

export const userPrincipal = (
  userId: string,
  workspaceId: string,
  readOnly = false,
  actorName?: string,
): Principal => ({
  id: `user:${userId}`,
  workspaceId,
  ...(readOnly ? { readOnly } : {}),
  ...(actorName ? { actorName } : {}),
});
