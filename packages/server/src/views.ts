import {
  currentRecipients,
  type AuditEvent,
  type Envelope,
  type Recipient,
} from '@codevibe_technology/sign-core';

/** What a signer may see: the envelope basics and their own fields only. */
export function signerView(
  envelope: Envelope,
  recipient: Recipient,
  auth: { required: boolean; authenticated: boolean },
) {
  const fields = envelope.fields.filter((f) => f.recipientId === recipient.id);
  const fieldIds = new Set(fields.map((f) => f.id));
  return {
    envelope: {
      id: envelope.id,
      title: envelope.title,
      message: envelope.message ?? null,
      status: envelope.status,
      expiresAt: envelope.expiresAt ?? null,
    },
    recipient: {
      id: recipient.id,
      name: recipient.name,
      email: recipient.email ?? null,
      role: recipient.role,
      status: recipient.status,
      auth: recipient.auth,
    },
    documents: envelope.documents.map((d) => ({ id: d.id, name: d.name, pageCount: d.pageCount })),
    fields,
    values: envelope.values.filter((v) => fieldIds.has(v.fieldId)),
    otpRequired: auth.required,
    authenticated: auth.authenticated,
    canAct: currentRecipients(envelope).some((r) => r.id === recipient.id),
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
