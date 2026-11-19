import 'server-only';
import {
  currentRecipients,
  type AuditEvent,
  type Envelope,
  type EnvelopeStatus,
} from '@codevibe_technology/sign-core';
import type postgres from 'postgres';

type Sql = postgres.Sql | postgres.TransactionSql;

export type StatusCounts = Record<
  'draft' | 'waiting' | 'completed' | 'declined' | 'expired' | 'voided',
  number
>;

/** How many of the workspace's envelopes are in each state, for the dashboard. */
export async function envelopeCounts(sql: Sql, workspaceId: string): Promise<StatusCounts> {
  const rows = await sql<{ status: EnvelopeStatus; n: number }[]>`
    select status, count(*)::int as n from sign_envelopes
    where workspace_id = ${workspaceId} group by status`;
  const counts: StatusCounts = {
    draft: 0,
    waiting: 0,
    completed: 0,
    declined: 0,
    expired: 0,
    voided: 0,
  };
  for (const { status, n } of rows) {
    if (status === 'sent' || status === 'in_progress') counts.waiting += n;
    else counts[status] += n;
  }
  return counts;
}

export interface WaitingItem {
  envelopeId: string;
  title: string;
  recipientId: string;
  sentAt: string | null;
  expiresAt: string | null;
}

/** Envelopes in the workspace where it is this email address's turn to sign or approve. */
export async function waitingOn(
  sql: Sql,
  workspaceId: string,
  email: string,
): Promise<WaitingItem[]> {
  const rows = await sql<{ data: Envelope }[]>`
    select data from sign_envelopes
    where workspace_id = ${workspaceId}
      and status in ('sent', 'in_progress')
      and data->'recipients' @> ${sql.json([{ email: email.toLowerCase() }])}
    order by created_at desc limit 50`;
  return rows.flatMap(({ data }) => {
    const mine = currentRecipients(data).find((r) => r.email === email.toLowerCase());
    return mine
      ? [
          {
            envelopeId: data.id,
            title: data.title,
            recipientId: mine.id,
            sentAt: data.sentAt ?? null,
            expiresAt: data.expiresAt ?? null,
          },
        ]
      : [];
  });
}

export interface ActivityItem {
  envelopeId: string;
  title: string;
  action: AuditEvent['action'];
  at: string;
  who: string | null;
}

/** The latest audit events across the workspace's most recently changed envelopes. */
export async function recentActivity(
  sql: Sql,
  workspaceId: string,
  limit = 12,
): Promise<ActivityItem[]> {
  const rows = await sql<{ event: AuditEvent; envelope: Envelope }[]>`
    with recent as (
      select id, data from sign_envelopes
      where workspace_id = ${workspaceId}
      order by updated_at desc limit 25
    )
    select e.data as event, r.data as envelope
    from sign_audit_events e join recent r on r.id = e.envelope_id
    where e.data->>'action' <> 'envelope.updated'
    order by e.data->>'at' desc, e.seq desc
    limit ${limit}`;
  return rows.map(({ event, envelope }) => ({
    envelopeId: envelope.id,
    title: envelope.title,
    action: event.action,
    at: event.at,
    who: envelope.recipients.find((r) => r.id === event.recipientId)?.name ?? null,
  }));
}

/** Remembers which member created an envelope from the app, for "void your own". */
export async function recordSender(
  sql: Sql,
  input: { workspaceId: string; envelopeId: string; userId: string },
) {
  await sql`insert into app_envelope_senders (envelope_id, workspace_id, user_id)
    values (${input.envelopeId}, ${input.workspaceId}, ${input.userId})
    on conflict (envelope_id) do nothing`;
}

export interface Sender {
  userId: string | null;
  name: string | null;
}

/** Who sent the envelope from the app, or null when it came from the API. */
export async function senderOf(
  sql: Sql,
  workspaceId: string,
  envelopeId: string,
): Promise<Sender | null> {
  const rows = await sql<{ user_id: string | null; name: string | null }[]>`
    select s.user_id, u.name from app_envelope_senders s
    left join auth_users u on u.id = s.user_id
    where s.envelope_id = ${envelopeId} and s.workspace_id = ${workspaceId}`;
  const row = rows[0];
  return row ? { userId: row.user_id, name: row.name } : null;
}

/** The envelopes among `ids` that this user sent from the app. */
export async function sentBy(
  sql: Sql,
  workspaceId: string,
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await sql<{ envelope_id: string }[]>`
    select envelope_id from app_envelope_senders
    where workspace_id = ${workspaceId} and user_id = ${userId}
      and envelope_id in ${sql(ids)}`;
  return new Set(rows.map((r) => r.envelope_id));
}

export interface SealedMatch {
  envelopeId: string;
  title: string;
  documentName: string;
}

/** The workspace envelope whose sealed document has exactly this SHA-256, if any. */
export async function findSealedDocument(
  sql: Sql,
  workspaceId: string,
  sha256: string,
): Promise<SealedMatch | null> {
  const rows = await sql<{ envelope: Envelope; document_id: string }[]>`
    select env.data as envelope, e.data->'data'->>'documentId' as document_id
    from sign_audit_events e join sign_envelopes env on env.id = e.envelope_id
    where env.workspace_id = ${workspaceId}
      and e.data->>'action' = 'document.sealed'
      and e.data->'data'->>'sha256' = ${sha256}
    limit 1`;
  const row = rows[0];
  if (!row) return null;
  const document = row.envelope.documents.find((d) => d.id === row.document_id);
  return {
    envelopeId: row.envelope.id,
    title: row.envelope.title,
    documentName: document?.name ?? 'Document',
  };
}
