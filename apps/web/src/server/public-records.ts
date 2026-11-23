import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  verifyChain,
  type AuditAction,
  type AuditEvent,
  type Envelope,
} from '@codevibe_technology/sign-core';
import { maskEmail, maskPhone, type CertificateData } from '@codevibe_technology/sign-pdf';
import { nodeHasher } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import { isRecordId, recordPath, type PublicRecordView, type SealState } from '@/lib/public-record';

type Sql = postgres.Sql | postgres.TransactionSql;

/** 18 random bytes: 144 bits, 24 characters in a link. */
const newRecordId = () => randomBytes(18).toString('base64url');

export const recordUrl = (appUrl: string, id: string) =>
  `${appUrl.replace(/\/+$/, '')}${recordPath(id)}`;

export async function publicRecordsEnabled(sql: Sql, workspaceId: string): Promise<boolean> {
  const [row] = await sql<{ public_records: boolean }[]>`
    select public_records from app_workspaces where id = ${workspaceId}`;
  return row?.public_records ?? false;
}

export async function setPublicRecords(sql: Sql, workspaceId: string, enabled: boolean) {
  await sql`update app_workspaces set public_records = ${enabled}, updated_at = now()
    where id = ${workspaceId}`;
  return enabled;
}

/**
 * The record id of a completed envelope, made on first use. Null when the workspace has
 * turned public records off; the certificate is then printed without a code.
 */
export async function ensurePublicRecord(
  sql: Sql,
  input: { workspaceId: string; envelopeId: string },
): Promise<string | null> {
  if (!(await publicRecordsEnabled(sql, input.workspaceId))) return null;
  // The no-op update makes the insert return the row that is already there.
  const [row] = await sql<{ id: string }[]>`
    insert into app_public_records (id, workspace_id, envelope_id)
    values (${newRecordId()}, ${input.workspaceId}, ${input.envelopeId})
    on conflict (envelope_id) do update set envelope_id = excluded.envelope_id
    returning id`;
  return row?.id ?? null;
}

export interface EnvelopeRecord {
  id: string;
  createdAt: string;
  revokedAt: string | null;
}

/** The record of an envelope for its own workspace, revoked or not. */
export async function recordOfEnvelope(
  sql: Sql,
  workspaceId: string,
  envelopeId: string,
): Promise<EnvelopeRecord | null> {
  const [row] = await sql<{ id: string; created_at: Date; revoked_at: Date | null }[]>`
    select id, created_at, revoked_at from app_public_records
    where envelope_id = ${envelopeId} and workspace_id = ${workspaceId}`;
  return row
    ? {
        id: row.id,
        createdAt: row.created_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() ?? null,
      }
    : null;
}

/** Turns an envelope's record off, or on again. Reports whether there was a record. */
export async function setRecordRevoked(
  sql: Sql,
  input: { workspaceId: string; envelopeId: string; revoked: boolean; userId: string },
): Promise<boolean> {
  const rows = input.revoked
    ? await sql`update app_public_records
        set revoked_at = coalesce(revoked_at, now()), revoked_by = ${input.userId}
        where envelope_id = ${input.envelopeId} and workspace_id = ${input.workspaceId}
        returning id`
    : await sql`update app_public_records set revoked_at = null, revoked_by = null
        where envelope_id = ${input.envelopeId} and workspace_id = ${input.workspaceId}
        returning id`;
  return rows.length > 0;
}

export interface LiveRecord {
  id: string;
  workspaceId: string;
  envelopeId: string;
  workspaceName: string;
  timeZone: string | null;
}

/**
 * The record behind a public link. A revoked record, one of a workspace that turned public
 * records off and an id that was never issued all answer null, so they look the same.
 */
export async function findLiveRecord(sql: Sql, id: string): Promise<LiveRecord | null> {
  if (!isRecordId(id)) return null;
  const [row] = await sql<
    {
      id: string;
      workspace_id: string;
      envelope_id: string;
      name: string;
      time_zone: string | null;
    }[]
  >`
    select r.id, r.workspace_id, r.envelope_id, w.name, w.time_zone
    from app_public_records r join app_workspaces w on w.id = r.workspace_id
    where r.id = ${id} and r.revoked_at is null and w.public_records`;
  return row
    ? {
        id: row.id,
        workspaceId: row.workspace_id,
        envelopeId: row.envelope_id,
        workspaceName: row.name,
        timeZone: row.time_zone,
      }
    : null;
}

export interface RecordSource {
  record: LiveRecord;
  envelope: Envelope;
  events: AuditEvent[];
  sender: { name: string | null; email: string | null };
}

/** The envelope and audit events of a live record, as stored. Not for showing as they are. */
export async function loadRecordSource(sql: Sql, id: string): Promise<RecordSource | null> {
  const record = await findLiveRecord(sql, id);
  if (!record) return null;
  const [row] = await sql<{ data: Envelope }[]>`
    select data from sign_envelopes
    where id = ${record.envelopeId} and workspace_id = ${record.workspaceId}`;
  if (!row || row.data.status !== 'completed') return null;
  const events = (
    await sql<{ data: AuditEvent }[]>`
      select data from sign_audit_events where envelope_id = ${record.envelopeId} order by seq`
  ).map((r) => r.data);
  return {
    record,
    envelope: row.data,
    events,
    sender: await senderContact(sql, record.workspaceId, record.envelopeId),
  };
}

async function senderContact(sql: Sql, workspaceId: string, envelopeId: string) {
  const [row] = await sql<{ name: string | null; email: string | null }[]>`
    select u.name, u.email from app_envelope_senders s
    left join auth_users u on u.id = s.user_id
    where s.envelope_id = ${envelopeId} and s.workspace_id = ${workspaceId}`;
  return { name: row?.name?.trim() || null, email: row?.email ?? null };
}

/** What the certificate says about who sent an envelope: the member, or the workspace. */
export async function certificateSender(
  sql: Sql,
  workspaceId: string,
  envelopeId: string,
): Promise<CertificateData['sender']> {
  const [workspace] = await sql<{ name: string }[]>`
    select name from app_workspaces where id = ${workspaceId}`;
  const member = await senderContact(sql, workspaceId, envelopeId);
  const organization = workspace?.name;
  if (member.name) {
    return {
      name: member.name,
      ...(organization ? { organization } : {}),
      ...(member.email ? { email: member.email } : {}),
    };
  }
  return organization ? { name: organization } : undefined;
}

const SENDER_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'envelope.created',
  'envelope.updated',
  'envelope.sent',
  'envelope.voided',
  'envelope.recalled',
  'envelope.revised',
  'recipient.link_shared',
  'recipient.corrected',
]);

function actorOf(event: AuditEvent, names: Map<string, string>): string {
  const by = event.data?.by;
  if (SENDER_ACTIONS.has(event.action)) {
    if (typeof by !== 'string' || !by) return 'Sender';
    return by.includes('@') ? maskEmail(by) : by;
  }
  return event.recipientId ? (names.get(event.recipientId) ?? 'Recipient') : 'System';
}

/** The hash of the last event recorded before the first document was sealed. */
function headBeforeSealing(events: AuditEvent[]): string | null {
  const first = events.findIndex((event) => event.action === 'document.sealed');
  return first > 0 ? (events[first - 1]?.hash ?? null) : null;
}

export interface SealAnswer {
  valid: boolean;
  /** SHA-256 of the stored sealed file. */
  sha256: string;
  signedAt: string | null;
}

/** Checks the stored sealed file of one document; null while it is not sealed yet. */
export type SealChecker = (
  workspaceId: string,
  envelopeId: string,
  documentId: string,
) => Promise<SealAnswer | null>;

/**
 * The public view of a record. Every field is picked by name from the stored envelope and
 * events, so nothing else they hold (addresses, browsers, event data, messages, values typed
 * into the document) can reach the page.
 */
export async function publicRecordView(
  source: RecordSource,
  checkSeal: SealChecker,
): Promise<PublicRecordView> {
  const { record, envelope, events } = source;
  const chain = await verifyChain(events, nodeHasher, {
    envelopeId: envelope.id,
    ...(envelope.auditHead ? { expectedHead: envelope.auditHead } : {}),
  });
  const sealedHashes = new Map<string, string>();
  for (const event of events) {
    if (event.action === 'document.sealed' && typeof event.data?.sha256 === 'string') {
      sealedHashes.set(String(event.data.documentId ?? ''), event.data.sha256);
    }
  }
  const names = new Map(envelope.recipients.map((r) => [r.id, r.name]));
  const documents = await Promise.all(
    envelope.documents.map(async (document) => {
      const sealedSha256 = sealedHashes.get(document.id) ?? null;
      const answer = sealedSha256
        ? await checkSeal(record.workspaceId, envelope.id, document.id).catch(() => null)
        : null;
      const seal: SealState = !sealedSha256
        ? 'pending'
        : answer?.valid && answer.sha256 === sealedSha256
          ? 'verified'
          : 'failed';
      return {
        name: document.name,
        pageCount: document.pageCount,
        sha256: document.sha256,
        sealedSha256,
        seal,
        sealedAt: seal === 'verified' ? (answer?.signedAt ?? null) : null,
      };
    }),
  );
  return {
    id: record.id,
    envelopeId: envelope.id,
    title: envelope.title,
    status: envelope.status,
    completedAt: envelope.completedAt ?? null,
    sender: { name: source.sender.name, organization: record.workspaceName },
    documents,
    signers: [...envelope.recipients]
      .sort((a, b) => a.order - b.order)
      .map((r) => ({
        name: r.name,
        contact: r.email ? maskEmail(r.email) : r.phone ? maskPhone(r.phone) : null,
        role: r.role,
        status: r.status,
        auth: r.auth,
        actedAt: r.actedAt ?? null,
      })),
    trail: events.map((event) => ({
      seq: event.seq,
      action: event.action,
      at: event.at,
      actor: actorOf(event, names),
      hash: event.hash,
    })),
    chain: {
      valid: chain.valid,
      head: chain.valid ? chain.head : null,
      headAtSealing: chain.valid ? headBeforeSealing(events) : null,
    },
  };
}

/** The events with only what the audit trail file prints: no addresses, browsers or data. */
const bareEvents = (events: AuditEvent[]): AuditEvent[] =>
  events.map((event) => ({
    seq: event.seq,
    envelopeId: event.envelopeId,
    action: event.action,
    at: event.at,
    ...(event.recipientId ? { recipientId: event.recipientId } : {}),
    ...(typeof event.data?.by === 'string' ? { data: { by: event.data.by } } : {}),
    prevHash: event.prevHash,
    hash: event.hash,
  }));

/** What `certificatePdf` and `auditTrailPdf` need to print a record's files. */
export function recordCertificates(
  source: RecordSource,
  appUrl: string,
  fallbackTimeZone: string | undefined,
): CertificateData[] {
  const { record, envelope, sender } = source;
  const timeZone = record.timeZone ?? fallbackTimeZone;
  const events = bareEvents(source.events);
  return envelope.documents.map((document) => ({
    envelope,
    document,
    events,
    recordUrl: recordUrl(appUrl, record.id),
    sender: sender.name
      ? {
          name: sender.name,
          organization: record.workspaceName,
          ...(sender.email ? { email: sender.email } : {}),
        }
      : { name: record.workspaceName },
    ...(timeZone ? { timeZone } : {}),
  }));
}
