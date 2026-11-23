import 'server-only';
import type postgres from 'postgres';
import { randomId } from '../crypto';

type Sql = postgres.Sql | postgres.TransactionSql;

export interface AuditEntry {
  /** Null for something that belongs to no workspace, such as a public purchase. */
  workspaceId?: string | null;
  /** The signed-in person, or null for the system or a webhook. */
  actorId?: string | null;
  /** For example `billing.invoice_issued` or `esign.credentials_changed`. */
  action: string;
  /** The id of what was acted on. */
  target?: string | null;
  /** Ids, amounts and names only. Never a secret, a token or a document. */
  data?: Record<string, string | number | boolean | null>;
  ip?: string | null;
}

export interface AuditRecord {
  id: string;
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  target: string | null;
  data: Record<string, string | number | boolean | null>;
  createdAt: string;
}

/** Appends one line to the audit log. Pass the transaction to record it with the change. */
export async function recordAudit(sql: Sql, entry: AuditEntry): Promise<void> {
  await sql`
    insert into app_audit_log (id, workspace_id, actor_id, action, target, data, ip)
    values (
      ${randomId('aud')}, ${entry.workspaceId ?? null}, ${entry.actorId ?? null},
      ${entry.action}, ${entry.target ?? null}, ${sql.json(entry.data ?? {})}, ${entry.ip ?? null}
    )`;
}

/** The newest audit lines of a workspace, optionally only actions starting with `prefix`. */
export async function listAudit(
  sql: Sql,
  workspaceId: string,
  options: { prefix?: string; limit?: number } = {},
): Promise<AuditRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await sql<
    {
      id: string;
      workspace_id: string | null;
      actor_id: string | null;
      action: string;
      target: string | null;
      data: AuditRecord['data'];
      created_at: Date;
    }[]
  >`
    select id, workspace_id, actor_id, action, target, data, created_at
    from app_audit_log
    where workspace_id = ${workspaceId}
      ${options.prefix ? sql`and starts_with(action, ${options.prefix})` : sql``}
    order by created_at desc, id desc
    limit ${limit}`;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    action: row.action,
    target: row.target,
    data: row.data,
    createdAt: row.created_at.toISOString(),
  }));
}
