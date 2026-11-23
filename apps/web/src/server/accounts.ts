import 'server-only';
import type postgres from 'postgres';
import { isPlan, type Plan } from '@/lib/plans';
import { randomId } from './crypto';
import { AppError } from './errors';
import { userLabel } from './profile';

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * The paying side of the app. A person has at most one account; it holds the plan, the
 * subscription, the eSign credits and the billing details, and every workspace they create
 * belongs to it. Limits are counted across all of an account's workspaces.
 */
export interface Account {
  id: string;
  /** Null only for a workspace that had nobody left when accounts were introduced. */
  ownerUserId: string | null;
  plan: Plan;
  planSource: 'operator' | 'billing';
  extraSeats: number;
}

interface AccountRow {
  id: string;
  owner_user_id: string | null;
  plan: string;
  plan_source: 'operator' | 'billing';
  extra_seats: number;
}

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  plan: isPlan(row.plan) ? row.plan : 'free',
  planSource: row.plan_source,
  extraSeats: row.extra_seats,
});

export async function accountOfWorkspace(sql: Sql, workspaceId: string): Promise<Account> {
  const [row] = await sql<AccountRow[]>`
    select a.id, a.owner_user_id, a.plan, a.plan_source, a.extra_seats
    from app_accounts a join app_workspaces w on w.account_id = a.id
    where w.id = ${workspaceId}`;
  if (!row) throw new AppError('NOT_FOUND', 'Workspace not found');
  return toAccount(row);
}

export async function accountIdOfWorkspace(sql: Sql, workspaceId: string): Promise<string> {
  const [row] = await sql<{ account_id: string }[]>`
    select account_id from app_workspaces where id = ${workspaceId}`;
  if (!row) throw new AppError('NOT_FOUND', 'Workspace not found');
  return row.account_id;
}

export async function getAccount(sql: Sql, accountId: string): Promise<Account | null> {
  const [row] = await sql<AccountRow[]>`
    select id, owner_user_id, plan, plan_source, extra_seats from app_accounts
    where id = ${accountId}`;
  return row ? toAccount(row) : null;
}

export async function accountOfUser(sql: Sql, userId: string): Promise<Account | null> {
  const [row] = await sql<AccountRow[]>`
    select id, owner_user_id, plan, plan_source, extra_seats from app_accounts
    where owner_user_id = ${userId}`;
  return row ? toAccount(row) : null;
}

/**
 * The person's account, created on `plan` when they have none, with its row locked for the
 * rest of the transaction. The lock on the user's row keeps two requests from each creating
 * one.
 */
export async function lockAccountOfUser(
  tx: postgres.TransactionSql,
  userId: string,
  plan: Plan,
): Promise<Account & { created: boolean }> {
  await tx`select 1 from auth_users where id = ${userId} for update`;
  const [existing] = await tx<AccountRow[]>`
    select id, owner_user_id, plan, plan_source, extra_seats from app_accounts
    where owner_user_id = ${userId} for update`;
  if (existing) return { ...toAccount(existing), created: false };
  const id = randomId('acct');
  await tx`insert into app_accounts (id, owner_user_id, plan) values (${id}, ${userId}, ${plan})`;
  return { id, ownerUserId: userId, plan, planSource: 'operator', extraSeats: 0, created: true };
}

/** Whether `userId` owns the account `workspaceId` belongs to: the one who manages its billing. */
export async function isAccountOwner(
  sql: Sql,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await sql`
    select 1 from app_workspaces w join app_accounts a on a.id = w.account_id
    where w.id = ${workspaceId} and a.owner_user_id = ${userId}`;
  return Boolean(row);
}

/** What to call the owner of a workspace's account, for "Managed by ...". */
export async function accountOwnerName(sql: Sql, workspaceId: string): Promise<string | null> {
  const [row] = await sql<{ name: string | null }[]>`
    select ${userLabel(sql)} as name
    from app_workspaces w join app_accounts a on a.id = w.account_id
    left join auth_users u on u.id = a.owner_user_id
    where w.id = ${workspaceId}`;
  return row?.name ?? null;
}

export interface AccountWorkspace {
  id: string;
  slug: string;
  name: string;
}

export async function accountWorkspaces(sql: Sql, accountId: string): Promise<AccountWorkspace[]> {
  return sql<AccountWorkspace[]>`
    select id, slug, name from app_workspaces where account_id = ${accountId}
    order by created_at, id`;
}

/**
 * Moves an account to a plan. The old per-workspace column is kept in step, so a build from
 * before accounts still reads a sensible plan if the install is rolled back.
 */
export async function setAccountPlan(
  tx: postgres.TransactionSql,
  accountId: string,
  change: { plan: Plan; source: 'operator' | 'billing'; extraSeats?: number },
): Promise<void> {
  await tx`
    update app_accounts
    set plan = ${change.plan}, plan_source = ${change.source},
      extra_seats = ${change.extraSeats ?? tx`extra_seats`}, updated_at = now()
    where id = ${accountId}`;
  await tx`update app_workspaces set plan = ${change.plan}, updated_at = now()
    where account_id = ${accountId} and plan <> ${change.plan}`;
}
