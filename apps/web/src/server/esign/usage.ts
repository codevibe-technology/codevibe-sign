import 'server-only';
import type postgres from 'postgres';
import type { EsignMode } from './settings';

type Sql = postgres.Sql | postgres.TransactionSql;

export type EsignUsageOutcome = 'signed' | 'declined' | 'expired' | 'failed';

export interface EsignUsage {
  ref: string;
  workspaceId: string;
  envelopeId: string;
  recipientId: string;
  mode: EsignMode;
  /** A prepaid credit was held for this eSign. */
  billed: boolean;
  outcome: EsignUsageOutcome | null;
  startedAt: string;
  endedAt: string | null;
}

interface Row {
  ref: string;
  workspace_id: string;
  envelope_id: string;
  recipient_id: string;
  mode: EsignMode;
  billed: boolean;
  outcome: EsignUsageOutcome | null;
  started_at: Date;
  ended_at: Date | null;
}

const toUsage = (row: Row): EsignUsage => ({
  ref: row.ref,
  workspaceId: row.workspace_id,
  envelopeId: row.envelope_id,
  recipientId: row.recipient_id,
  mode: row.mode,
  billed: row.billed,
  outcome: row.outcome,
  startedAt: row.started_at.toISOString(),
  endedAt: row.ended_at?.toISOString() ?? null,
});

/** Notes that an eSign started and on which account; a repeat for the same `ref` changes nothing. */
export async function recordEsignStart(
  sql: Sql,
  input: {
    ref: string;
    workspaceId: string;
    envelopeId: string;
    recipientId: string;
    mode: EsignMode;
    billed: boolean;
    /** The provider's test environment is used. */
    sandbox?: boolean;
  },
): Promise<void> {
  await sql`
    insert into app_esign_usage
      (ref, workspace_id, envelope_id, recipient_id, mode, billed, sandbox)
    values (
      ${input.ref}, ${input.workspaceId}, ${input.envelopeId}, ${input.recipientId},
      ${input.mode}, ${input.billed}, ${input.sandbox ?? false}
    )
    on conflict (ref) do nothing`;
}

export async function getEsignUsage(sql: Sql, ref: string): Promise<EsignUsage | null> {
  const rows = await sql<Row[]>`
    select ref, workspace_id, envelope_id, recipient_id, mode, billed, outcome, started_at,
           ended_at
    from app_esign_usage where ref = ${ref}`;
  return rows[0] ? toUsage(rows[0]) : null;
}

/**
 * Writes how an eSign ended and answers whether that is news. `signed` replaces an earlier
 * `expired` or `failed`; nothing replaces `signed`.
 */
export async function recordEsignOutcome(
  sql: Sql,
  ref: string,
  outcome: EsignUsageOutcome,
): Promise<boolean> {
  const rows = await sql`
    update app_esign_usage set outcome = ${outcome}, ended_at = now()
    where ref = ${ref}
      and (outcome is null or (${outcome} = 'signed' and outcome <> 'signed'))
    returning ref`;
  return rows.length > 0;
}

/** Marks an eSign that was signed with no credit left to pay for it; true the first time. */
export async function markUnbilled(sql: Sql, ref: string): Promise<boolean> {
  const rows = await sql`
    update app_esign_usage set unbilled = true where ref = ${ref} and not unbilled
    returning ref`;
  return rows.length > 0;
}

export interface EsignUsageLine extends EsignUsage {
  envelopeTitle: string | null;
}

/** The newest eSigns of a workspace, with the title of each envelope. */
export async function listEsignUsage(
  sql: Sql,
  workspaceId: string,
  limit = 20,
): Promise<EsignUsageLine[]> {
  const rows = await sql<(Row & { title: string | null })[]>`
    select u.ref, u.workspace_id, u.envelope_id, u.recipient_id, u.mode, u.billed, u.outcome,
           u.started_at, u.ended_at, e.data->>'title' as title
    from app_esign_usage u
    left join sign_envelopes e on e.id = u.envelope_id and e.workspace_id = u.workspace_id
    where u.workspace_id = ${workspaceId}
    order by u.started_at desc
    limit ${Math.min(Math.max(limit, 1), 100)}`;
  return rows.map((row) => ({ ...toUsage(row), envelopeTitle: row.title }));
}
