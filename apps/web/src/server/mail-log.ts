import 'server-only';
import type { MailMessage, Mailer } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import { MAIL_LOG_LIMIT, MAIL_LOG_RETENTION_DAYS, type MailLogStatus } from '@/lib/mail-log';
import { randomId } from './crypto';

type Sql = postgres.Sql;

/** One outgoing email as the log keeps it: who, what kind, and how it went. No body or link. */
export interface MailLogEntry {
  workspaceId: string | null;
  envelopeId: string | null;
  recipientId: string | null;
  kind: string;
  recipientEmail: string;
  subject: string;
  providerMessageId: string | null;
  status: MailLogStatus;
  error: string | null;
  attachmentCount: number;
  attachmentBytes: number;
}

export interface MailLogRecord extends MailLogEntry {
  id: string;
  createdAt: Date;
}

const MAX_ERROR = 300;
const MAX_SUBJECT = 200;

/**
 * An SMTP error as one short line, with links taken out: providers sometimes quote the message
 * they refused, and a signing link must never reach the log.
 */
export function trimError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const clean = text
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_ERROR ? `${clean.slice(0, MAX_ERROR - 1)}…` : clean || 'Unknown error';
}

/** The subject as logged. One-time code emails carry the code in it, so it is left out. */
export function loggedSubject(message: MailMessage): string {
  if (message.meta?.kind === 'otp') return 'Your signing code';
  const subject = message.subject.replace(/[\r\n]+/g, ' ').trim();
  return subject.length > MAX_SUBJECT ? `${subject.slice(0, MAX_SUBJECT - 1)}…` : subject;
}

export function entryFor(
  message: MailMessage,
  outcome: { messageId?: string | null; error?: unknown },
): MailLogEntry {
  const attachments = message.attachments ?? [];
  const failed = outcome.error !== undefined;
  return {
    workspaceId: message.meta?.workspaceId ?? null,
    envelopeId: message.meta?.envelopeId ?? null,
    recipientId: message.meta?.recipientId ?? null,
    kind: message.meta?.kind ?? 'other',
    recipientEmail: message.to.trim().toLowerCase(),
    subject: loggedSubject(message),
    providerMessageId: outcome.messageId ?? null,
    status: failed ? 'failed' : 'sent',
    error: failed ? trimError(outcome.error) : null,
    attachmentCount: attachments.length,
    attachmentBytes: attachments.reduce((sum, a) => sum + a.content.byteLength, 0),
  };
}

/**
 * Wraps a mailer so every send, sent or failed, is recorded. A failure is still thrown to the
 * caller, so retries work as before; a failure to record is reported and otherwise ignored.
 */
export function loggingMailer(
  mailer: Mailer,
  record: (entry: MailLogEntry) => Promise<void>,
  report: (err: unknown) => void = (err) =>
    console.error('[mail log] failed', err instanceof Error ? err.message : err),
): Mailer {
  const save = (entry: MailLogEntry) => record(entry).catch(report);
  return {
    async send(message) {
      try {
        const receipt = await mailer.send(message);
        await save(entryFor(message, { messageId: receipt?.messageId ?? null }));
        return receipt;
      } catch (err) {
        await save(entryFor(message, { error: err }));
        throw err;
      }
    },
  };
}

export async function recordMail(sql: Sql, entry: MailLogEntry): Promise<void> {
  await sql`
    insert into app_mail_log (
      id, workspace_id, envelope_id, recipient_id, kind, recipient_email, subject,
      provider_message_id, status, error, attachment_count, attachment_bytes
    ) values (
      ${randomId('mail')}, ${entry.workspaceId}, ${entry.envelopeId}, ${entry.recipientId},
      ${entry.kind}, ${entry.recipientEmail}, ${entry.subject}, ${entry.providerMessageId},
      ${entry.status}, ${entry.error}, ${entry.attachmentCount}, ${entry.attachmentBytes}
    )`;
}

interface Row {
  id: string;
  workspace_id: string | null;
  envelope_id: string | null;
  recipient_id: string | null;
  kind: string;
  recipient_email: string;
  subject: string;
  provider_message_id: string | null;
  status: MailLogStatus;
  error: string | null;
  attachment_count: number;
  attachment_bytes: string | number;
  created_at: Date;
}

const toRecord = (row: Row): MailLogRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  envelopeId: row.envelope_id,
  recipientId: row.recipient_id,
  kind: row.kind,
  recipientEmail: row.recipient_email,
  subject: row.subject,
  providerMessageId: row.provider_message_id,
  status: row.status,
  error: row.error,
  attachmentCount: row.attachment_count,
  attachmentBytes: Number(row.attachment_bytes),
  createdAt: row.created_at,
});

/** The workspace's latest emails, newest first, optionally for one envelope. */
export async function listMailLog(
  sql: Sql,
  workspaceId: string,
  options: { envelopeId?: string | null; limit?: number } = {},
): Promise<MailLogRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? MAIL_LOG_LIMIT, 1), MAIL_LOG_LIMIT);
  const rows = await sql<Row[]>`
    select * from app_mail_log
    where workspace_id = ${workspaceId}
      ${options.envelopeId ? sql`and envelope_id = ${options.envelopeId}` : sql``}
    order by created_at desc, id desc
    limit ${limit}`;
  return rows.map(toRecord);
}

/** The last completed-copy email to each recipient of an envelope, by recipient id. */
export async function completedCopyMail(
  sql: Sql,
  workspaceId: string,
  envelopeId: string,
): Promise<Record<string, MailLogRecord>> {
  const rows = await sql<Row[]>`
    select distinct on (recipient_id) * from app_mail_log
    where workspace_id = ${workspaceId} and envelope_id = ${envelopeId}
      and kind = 'completed_copy' and recipient_id is not null
    order by recipient_id, created_at desc, id desc`;
  return Object.fromEntries(rows.map((row) => [row.recipient_id!, toRecord(row)]));
}

/** Deletes log rows older than the retention period. */
export async function pruneMailLog(sql: Sql, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MAIL_LOG_RETENTION_DAYS * 86_400_000);
  const result = await sql`delete from app_mail_log where created_at < ${cutoff}`;
  return result.count;
}
