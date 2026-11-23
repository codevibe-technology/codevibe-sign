import 'server-only';
import type postgres from 'postgres';
import { limitsFor, type Plan, type PlanSettings } from '@/lib/plans';
import { isTimeZone } from '@/lib/preferences';
import { suggestAddress } from '@/lib/workspace-address';
import type { Role } from '@/lib/roles';
import { randomId } from './crypto';
import { AppError } from './errors';
import { accountOfUser, accountWorkspaces, lockAccountOfUser, setAccountPlan } from './accounts';
import {
  assertRoom,
  countAccountWorkspaces,
  limitError,
  planSettings,
  type PlanLimitError,
} from './plans';
import {
  assertAddressFree,
  claimAddress,
  freeAlternatives,
  isSlugConflict,
  lockAddresses,
  unavailableAddresses,
} from './workspace-address';

type Sql = postgres.Sql | postgres.TransactionSql;

export interface Workspace {
  id: string;
  slug: string;
  name: string;
}

export interface Membership {
  workspace: Workspace;
  role: Role;
}

export const WORKSPACE_NAME_MAX = 80;

export function cleanWorkspaceName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) throw new AppError('VALIDATION', 'Give the workspace a name', 'name');
  if (clean.length > WORKSPACE_NAME_MAX) {
    throw new AppError(
      'VALIDATION',
      `Keep the name under ${WORKSPACE_NAME_MAX} characters`,
      'name',
    );
  }
  return clean;
}

/**
 * Creates a workspace with `userId` as its owner and default brand settings, atomically. The
 * address is `slug` when given (refused with a field error when it is not free) or one made
 * from the name. The workspace joins the person's account, which is created with them when
 * they have none: on the Free plan in hosted mode. An account holds only as many workspaces
 * as its plan includes; its row is locked while they are counted, so two tabs cannot both
 * create one. `plan` puts the account on that plan first, for the operator and for tests.
 */
export async function createWorkspace(
  sql: postgres.Sql,
  input: { name: string; userId: string; slug?: string | undefined; plan?: Plan },
  settings: PlanSettings = planSettings(),
): Promise<Workspace & { plan: Plan; accountId: string }> {
  const name = cleanWorkspaceName(input.name);
  const starting = input.plan ?? (settings.mode === 'hosted' ? 'free' : 'unlimited');
  try {
    return await sql.begin(async (tx) => {
      const account = await lockAccountOfUser(tx, input.userId, starting);
      if (input.plan && account.plan !== input.plan) {
        await setAccountPlan(tx, account.id, { plan: input.plan, source: account.planSource });
      }
      const plan = input.plan ?? account.plan;
      const limits = limitsFor(plan, settings, account.extraSeats);
      if (limits.ownedWorkspaces !== null) {
        const held = await countAccountWorkspaces(tx, account.id);
        assertRoom({ plan, limits, accountId: account.id }, 'ownedWorkspaces', held, 1, 'name');
      }
      const slug = input.slug ?? (await addressFromName(tx, name));
      await lockAddresses(tx, [slug]);
      await assertAddressFree(tx, slug, null);
      await claimAddress(tx, slug);
      const id = randomId('ws');
      await tx`insert into app_workspaces (id, slug, name, created_by, plan, account_id)
        values (${id}, ${slug}, ${name}, ${input.userId}, ${plan}, ${account.id})`;
      await tx`insert into app_members (workspace_id, user_id, role)
        values (${id}, ${input.userId}, 'owner')`;
      await tx`insert into app_brand_settings (workspace_id) values (${id})`;
      return { id, slug, name, plan, accountId: account.id };
    });
  } catch (err) {
    if (isSlugConflict(err)) {
      throw new AppError('CONFLICT', 'Someone just took this address. Try another one.', 'slug');
    }
    throw err;
  }
}

/**
 * Why the person cannot create another workspace now, for the page that would offer it: their
 * account already holds as many as its plan includes. Null when they can. The check that
 * counts is the one in `createWorkspace`; this only saves them filling in the form.
 */
export async function newWorkspaceBlock(
  sql: Sql,
  userId: string,
  settings: PlanSettings = planSettings(),
): Promise<{ error: PlanLimitError; slug: string | null } | null> {
  if (settings.mode === 'self-hosted') return null;
  const account = await accountOfUser(sql, userId);
  if (!account) return null;
  const limits = limitsFor(account.plan, settings, account.extraSeats);
  if (limits.ownedWorkspaces === null) return null;
  const held = await accountWorkspaces(sql, account.id);
  if (held.length < limits.ownedWorkspaces) return null;
  return {
    error: limitError('ownedWorkspaces', held.length, limits.ownedWorkspaces, account.plan),
    slug: held[0]?.slug ?? null,
  };
}

/** The address the name suggests, or the first free one numbered after it. */
async function addressFromName(tx: postgres.TransactionSql, name: string): Promise<string> {
  const base = suggestAddress(name);
  if (!(await unavailableAddresses(tx, [base])).has(base)) return base;
  const [first] = await freeAlternatives(tx, base, null, 1);
  return first ?? `${base.slice(0, 30).replace(/-+$/, '')}-${randomId('x').slice(-6)}`;
}

export async function countWorkspaces(sql: Sql): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from app_workspaces`;
  return row?.count ?? 0;
}

export async function listWorkspacesForUser(sql: Sql, userId: string): Promise<Membership[]> {
  const rows = await sql<{ id: string; slug: string; name: string; role: Role }[]>`
    select w.id, w.slug, w.name, m.role
    from app_members m join app_workspaces w on w.id = m.workspace_id
    where m.user_id = ${userId}
    order by lower(w.name), w.id`;
  return rows.map(({ role, ...workspace }) => ({ workspace, role }));
}

/** The user's membership of a workspace, found by id or slug; null when they are not a member. */
export async function findMembership(
  sql: Sql,
  userId: string,
  by: { id: string } | { slug: string },
): Promise<Membership | null> {
  const rows = await sql<{ id: string; slug: string; name: string; role: Role }[]>`
    select w.id, w.slug, w.name, m.role
    from app_members m join app_workspaces w on w.id = m.workspace_id
    where m.user_id = ${userId}
      and ${'id' in by ? sql`w.id = ${by.id}` : sql`w.slug = ${by.slug}`}`;
  const row = rows[0];
  if (!row) return null;
  const { role, ...workspace } = row;
  return { workspace, role };
}

/** The zone a workspace chose for its documents and emails, or null while it uses the default. */
export async function workspaceTimeZone(sql: Sql, workspaceId: string): Promise<string | null> {
  const [row] = await sql<{ time_zone: string | null }[]>`
    select time_zone from app_workspaces where id = ${workspaceId}`;
  return row?.time_zone ?? null;
}

export async function setWorkspaceTimeZone(sql: Sql, workspaceId: string, timeZone: string) {
  if (!isTimeZone(timeZone)) {
    throw new AppError('VALIDATION', 'Pick a time zone from the list', 'timeZone');
  }
  await sql`update app_workspaces set time_zone = ${timeZone}, updated_at = now()
    where id = ${workspaceId}`;
  return timeZone;
}

export async function renameWorkspace(sql: Sql, workspaceId: string, name: string) {
  const clean = cleanWorkspaceName(name);
  await sql`update app_workspaces set name = ${clean}, updated_at = now()
    where id = ${workspaceId}`;
  return clean;
}
