import 'server-only';
import {
  verifyChain,
  type AuditAction,
  type AuditEvent,
  type AuthMethod,
  type Envelope,
  type RecipientRole,
  type RecipientStatus,
} from '@codevibe_technology/sign-core';
import { nodeHasher } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import { maskEmail, maskPhone } from '@codevibe_technology/sign-pdf';

type Sql = postgres.Sql | postgres.TransactionSql;

export interface EvidenceRecipient {
  name: string;
  /** Masked the way the signing certificate prints it, for example a****@example.com. */
  contact: string | null;
  role: RecipientRole;
  status: RecipientStatus;
  auth: AuthMethod;
  actedAt: string | null;
}

export interface EvidenceEvent {
  seq: number;
  action: AuditAction;
  at: string;
  /** Name of the recipient the event is about, when there is one. */
  recipient: string | null;
}

/**
 * What the public verify page shows for a file this install sealed: the same facts the
 * certificate page inside the file prints, without IP addresses or browsers.
 */
export interface SealedEvidence {
  title: string;
  documentName: string;
  sentAt: string | null;
  completedAt: string | null;
  recipients: EvidenceRecipient[];
  events: EvidenceEvent[];
  chain: { valid: boolean; head: string | null; events: number };
}

/** The sealed document with exactly this SHA-256, in any workspace of the install, with its trail. */
export async function sealedEvidence(sql: Sql, sha256: string): Promise<SealedEvidence | null> {
  const rows = await sql<{ envelope: Envelope; document_id: string }[]>`
    select env.data as envelope, e.data->'data'->>'documentId' as document_id
    from sign_audit_events e join sign_envelopes env on env.id = e.envelope_id
    where e.data->>'action' = 'document.sealed'
      and e.data->'data'->>'sha256' = ${sha256}
    limit 1`;
  const row = rows[0];
  if (!row) return null;
  const events = (
    await sql<{ data: AuditEvent }[]>`
      select data from sign_audit_events where envelope_id = ${row.envelope.id} order by seq`
  ).map((r) => r.data);
  return evidenceFrom(row.envelope, row.document_id, events);
}

export async function evidenceFrom(
  envelope: Envelope,
  documentId: string,
  events: AuditEvent[],
): Promise<SealedEvidence> {
  const chain = await verifyChain(events, nodeHasher, {
    envelopeId: envelope.id,
    ...(envelope.auditHead ? { expectedHead: envelope.auditHead } : {}),
  });
  const names = new Map(envelope.recipients.map((r) => [r.id, r.name]));
  return {
    title: envelope.title,
    documentName: envelope.documents.find((d) => d.id === documentId)?.name ?? 'Document',
    sentAt: envelope.sentAt ?? null,
    completedAt: envelope.completedAt ?? null,
    recipients: envelope.recipients.map((r) => ({
      name: r.name,
      contact: r.email ? maskEmail(r.email) : r.phone ? maskPhone(r.phone) : null,
      role: r.role,
      status: r.status,
      auth: r.auth,
      actedAt: r.actedAt ?? null,
    })),
    events: events.map((e) => ({
      seq: e.seq,
      action: e.action,
      at: e.at,
      recipient: e.recipientId ? (names.get(e.recipientId) ?? null) : null,
    })),
    chain: {
      valid: chain.valid,
      head: chain.valid ? chain.head : null,
      events: events.length,
    },
  };
}
