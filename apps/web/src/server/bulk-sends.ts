import 'server-only';
import type postgres from 'postgres';
import type { BulkRowPlan, BulkRowStatus, BulkStatus } from '@/lib/bulk-send';
import type { People } from '@/lib/templates';
import { randomId } from './crypto';
import { AppError } from './errors';
import { userLabel } from './profile';

type Sql = postgres.Sql;

export type { BulkRowStatus, BulkStatus };

export interface BulkSendRecord {
  id: string;
  workspaceId: string;
  templateId: string;
  templateName: string;
  createdBy: string | null;
  createdByName: string | null;
  status: BulkStatus;
  total: number;
  sent: number;
  failed: number;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface BulkRowRecord {
  line: number;
  people: People;
  metadata: Record<string, string>;
  status: BulkRowStatus;
  envelopeId: string | null;
  error: string | null;
}

interface RowInput {
  people: People;
  metadata: Record<string, string>;
}

/** How long one worker owns a bulk send before another may pick it up. */
export const BULK_LEASE_MS = 2 * 60_000;

export async function createBulkSend(
  sql: Sql,
  input: {
    workspaceId: string;
    templateId: string;
    templateName: string;
    createdBy: string;
    rows: BulkRowPlan[];
  },
): Promise<string> {
  if (input.rows.length === 0) {
    throw new AppError('VALIDATION', 'There are no rows ready to send.', 'csv');
  }
  const id = randomId('bulk');
  await sql.begin(async (tx) => {
    await tx`insert into app_bulk_sends (id, workspace_id, template_id, template_name, created_by, total)
      values (${id}, ${input.workspaceId}, ${input.templateId}, ${input.templateName},
        ${input.createdBy}, ${input.rows.length})`;
    const rows = input.rows.map((r) => ({
      line: r.line,
      input: { people: r.people, metadata: r.metadata },
    }));
    await tx`insert into app_bulk_send_rows (bulk_id, line, input)
      select ${id}, x.line, x.input
      from jsonb_to_recordset(${tx.json(rows as unknown as postgres.JSONValue)}) as x(line int, input jsonb)`;
  });
  return id;
}

const SELECT = (sql: Sql) => sql`
  select b.id, b.workspace_id as "workspaceId", b.template_id as "templateId",
    b.template_name as "templateName", b.created_by as "createdBy", ${userLabel(sql)} as "createdByName",
    b.status, b.total, b.created_at as "createdAt", b.finished_at as "finishedAt",
    (select count(*)::int from app_bulk_send_rows r where r.bulk_id = b.id and r.status = 'sent') as sent,
    (select count(*)::int from app_bulk_send_rows r where r.bulk_id = b.id and r.status = 'failed') as failed
  from app_bulk_sends b left join auth_users u on u.id = b.created_by`;

export async function getBulkSend(
  sql: Sql,
  workspaceId: string,
  id: string,
): Promise<BulkSendRecord | null> {
  const [row] = await sql<BulkSendRecord[]>`${SELECT(sql)}
    where b.id = ${id} and b.workspace_id = ${workspaceId}`;
  return row ?? null;
}

export async function listBulkSends(
  sql: Sql,
  workspaceId: string,
  options: { templateId?: string; limit?: number } = {},
): Promise<BulkSendRecord[]> {
  return sql<BulkSendRecord[]>`${SELECT(sql)}
    where b.workspace_id = ${workspaceId}
      ${options.templateId ? sql`and b.template_id = ${options.templateId}` : sql``}
    order by b.created_at desc
    limit ${options.limit ?? 10}`;
}

export async function listBulkRows(
  sql: Sql,
  bulkId: string,
  options: { status?: BulkRowStatus; line?: number } = {},
): Promise<BulkRowRecord[]> {
  const rows = await sql<(Omit<BulkRowRecord, 'people' | 'metadata'> & { input: RowInput })[]>`
    select line, input, status, envelope_id as "envelopeId", error from app_bulk_send_rows
    where bulk_id = ${bulkId}
      ${options.status ? sql`and status = ${options.status}` : sql``}
      ${options.line !== undefined ? sql`and line = ${options.line}` : sql``}
    order by line`;
  return rows.map(({ input, ...r }) => ({ ...r, people: input.people, metadata: input.metadata }));
}

/** Takes the bulk send for this worker unless another holds a live lease. */
export async function claimBulkSend(sql: Sql, id: string, now: Date): Promise<boolean> {
  const until = new Date(now.getTime() + BULK_LEASE_MS);
  const rows = await sql`update app_bulk_sends set lease_until = ${until}
    where id = ${id} and status = 'sending' and (lease_until is null or lease_until < ${now})
    returning id`;
  return rows.length > 0;
}

export async function releaseBulkSend(sql: Sql, id: string) {
  await sql`update app_bulk_sends set lease_until = null where id = ${id}`;
}

export async function markBulkRow(
  sql: Sql,
  bulkId: string,
  line: number,
  outcome: { envelopeId: string } | { error: string },
) {
  if ('envelopeId' in outcome) {
    await sql`update app_bulk_send_rows set status = 'sent', envelope_id = ${outcome.envelopeId},
      error = null, updated_at = now() where bulk_id = ${bulkId} and line = ${line}`;
  } else {
    await sql`update app_bulk_send_rows set status = 'failed', error = ${outcome.error},
      updated_at = now() where bulk_id = ${bulkId} and line = ${line}`;
  }
}

/** Marks the send done once no row is waiting. Returns whether it is finished. */
export async function finishIfDone(sql: Sql, id: string): Promise<boolean> {
  const rows =
    await sql`update app_bulk_sends set status = 'done', finished_at = now(), lease_until = null
    where id = ${id} and status = 'sending'
      and not exists (select 1 from app_bulk_send_rows where bulk_id = ${id} and status = 'pending')
    returning id`;
  return rows.length > 0;
}

/** Stops a bulk send: rows not sent yet are marked as not sent. */
export async function cancelBulkSend(sql: Sql, workspaceId: string, id: string) {
  await sql.begin(async (tx) => {
    const rows =
      await tx`update app_bulk_sends set status = 'cancelled', finished_at = now(), lease_until = null
      where id = ${id} and workspace_id = ${workspaceId} and status = 'sending' returning id`;
    if (rows.length === 0) throw new AppError('CONFLICT', 'This bulk send has already finished.');
    await tx`update app_bulk_send_rows set status = 'failed', error = 'Stopped before it was sent',
      updated_at = now() where bulk_id = ${id} and status = 'pending'`;
  });
}

/** Bulk sends still sending that no worker holds; after a restart, for example. */
export async function openBulkSends(
  sql: Sql,
  now: Date,
): Promise<{ id: string; workspaceId: string }[]> {
  return sql<{ id: string; workspaceId: string }[]>`
    select id, workspace_id as "workspaceId" from app_bulk_sends
    where status = 'sending' and (lease_until is null or lease_until < ${now})
    order by created_at limit 20`;
}

export interface BulkWorkerDeps {
  sql: Sql;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Sends one row; throws `RateLimitedError` to wait, anything else fails the row. */
  send: (row: BulkRowRecord) => Promise<{ envelopeId: string }>;
  isRateLimit: (err: unknown) => number | null;
  describe: (err: unknown) => string;
}

/**
 * Works through a bulk send's pending rows one at a time, waiting when the API says too many
 * envelopes were created in the last minute. Returns once every row is done, the send was
 * stopped, or another worker holds it.
 */
export async function runBulkSend(deps: BulkWorkerDeps, id: string): Promise<void> {
  const { sql } = deps;
  if (!(await claimBulkSend(sql, id, deps.now()))) return;
  try {
    for (;;) {
      const [status] = await sql<
        { status: BulkStatus }[]
      >`select status from app_bulk_sends where id = ${id}`;
      if (status?.status !== 'sending') return;
      const [row] = await sql<{ line: number }[]>`select line from app_bulk_send_rows
        where bulk_id = ${id} and status = 'pending' order by line limit 1`;
      if (!row) {
        await finishIfDone(sql, id);
        return;
      }
      const [record] = await listBulkRows(sql, id, { line: row.line });
      try {
        const sent = await deps.send(record!);
        await markBulkRow(sql, id, row.line, sent);
      } catch (err) {
        const wait = deps.isRateLimit(err);
        if (wait !== null) {
          await deps.sleep(wait * 1000);
        } else {
          await markBulkRow(sql, id, row.line, { error: deps.describe(err) });
        }
      }
      await sql`update app_bulk_sends set lease_until = ${new Date(deps.now().getTime() + BULK_LEASE_MS)}
        where id = ${id} and status = 'sending'`;
    }
  } finally {
    await releaseBulkSend(sql, id);
  }
}
