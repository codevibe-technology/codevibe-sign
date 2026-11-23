import { maskEmail } from '@codevibe_technology/sign-pdf';
import {
  currentRecipients,
  hasActed,
  type AuditEvent,
  type Document,
  type Envelope,
  type Recipient,
} from '@codevibe_technology/sign-core';

export type ApiDocument = Omit<Document, 'fileKey'>;
export type ApiEnvelope = Omit<Envelope, 'documents'> & { documents: ApiDocument[] };

/**
 * An envelope as the API answers with it: everything except where the file store keeps each
 * document, which is the server's own business.
 */
export function apiEnvelope(envelope: Envelope): ApiEnvelope {
  return {
    ...envelope,
    documents: envelope.documents.map((document) => {
      const { fileKey, ...rest } = document;
      void fileKey;
      return rest;
    }),
  };
}

/**
 * What a signer may see: the envelope basics and their own fields only. While a one-time code
 * is still owed, the holder of the link has not shown they are the recipient, so they get no
 * more than the invitation email already says: no message, documents, fields or values, and
 * the address only in masked form.
 */
export function signerView(
  envelope: Envelope,
  recipient: Recipient,
  workspaceId: string,
  auth: { required: boolean; authenticated: boolean },
) {
  const locked = auth.required && !auth.authenticated;
  const fields = locked ? [] : envelope.fields.filter((f) => f.recipientId === recipient.id);
  const fieldIds = new Set(fields.map((f) => f.id));
  const email = recipient.email ?? null;
  return {
    workspaceId,
    envelope: {
      id: envelope.id,
      title: envelope.title,
      message: locked ? null : (envelope.message ?? null),
      changeNote: locked ? null : (envelope.changeNote ?? null),
      status: envelope.status,
      expiresAt: envelope.expiresAt ?? null,
    },
    recipient: {
      id: recipient.id,
      name: recipient.name,
      email: locked && email ? maskEmail(email) : email,
      role: recipient.role,
      status: recipient.status,
      auth: recipient.auth,
    },
    documents: locked
      ? []
      : envelope.documents.map((d) => ({ id: d.id, name: d.name, pageCount: d.pageCount })),
    fields,
    values: envelope.values.filter((v) => fieldIds.has(v.fieldId)),
    otpRequired: auth.required,
    authenticated: auth.authenticated,
    canAct: currentRecipients(envelope).some((r) => r.id === recipient.id),
  };
}

/**
 * What a recipient who has signed may still see: where the envelope stands, how many people it
 * is waiting for (not who), and which documents are sealed and ready to download.
 */
export function receiptView(
  envelope: Envelope,
  recipient: Recipient,
  workspaceId: string,
  sealed: ReadonlySet<string>,
) {
  return {
    workspaceId,
    envelope: {
      id: envelope.id,
      title: envelope.title,
      status: envelope.status,
      completedAt: envelope.completedAt ?? null,
    },
    recipient: {
      id: recipient.id,
      name: recipient.name,
      role: recipient.role,
      status: recipient.status,
    },
    waitingFor: envelope.recipients.filter((r) => r.role !== 'viewer' && !hasActed(r)).length,
    documents: envelope.documents.map((d) => ({
      id: d.id,
      name: d.name,
      sealed: sealed.has(d.id),
    })),
  };
}

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
    role: Recipient['role'];
    auth: Recipient['auth'];
    status: Recipient['status'];
    actions: { action: string; at: string; ip: string | null; userAgent: string | null }[];
  }[];
}

export function certificateView(
  envelope: Envelope,
  events: AuditEvent[],
  chainValid: boolean,
): CertificateView {
  const sealed = new Map(
    events
      .filter((e) => e.action === 'document.sealed')
      .map((e) => [String(e.data?.documentId), String(e.data?.sha256)]),
  );
  return {
    envelopeId: envelope.id,
    title: envelope.title,
    status: envelope.status,
    completedAt: envelope.completedAt ?? null,
    auditHead: events.at(-1)?.hash ?? null,
    chainValid,
    documents: envelope.documents.map((d) => ({
      id: d.id,
      name: d.name,
      sha256: d.sha256,
      sealedSha256: sealed.get(d.id) ?? null,
    })),
    recipients: envelope.recipients.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email ?? null,
      phone: r.phone ?? null,
      role: r.role,
      auth: r.auth,
      status: r.status,
      actions: events
        .filter((e) => e.recipientId === r.id)
        .map((e) => ({
          action: e.action,
          at: e.at,
          ip: e.context?.ip ?? null,
          userAgent: e.context?.userAgent ?? null,
        })),
    })),
  };
}

/** One row of `GET /v1/envelopes`: enough for a list, without fields or values. */
export function envelopeSummary(envelope: Envelope) {
  return {
    id: envelope.id,
    title: envelope.title,
    status: envelope.status,
    createdAt: envelope.createdAt,
    sentAt: envelope.sentAt ?? null,
    completedAt: envelope.completedAt ?? null,
    expiresAt: envelope.expiresAt ?? null,
    metadata: envelope.metadata ?? {},
    documents: envelope.documents.map((d) => ({ id: d.id, name: d.name, pageCount: d.pageCount })),
    recipients: envelope.recipients.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email ?? null,
      role: r.role,
      status: r.status,
      actedAt: r.actedAt ?? null,
      declineReason: r.declineReason ?? null,
    })),
  };
}
