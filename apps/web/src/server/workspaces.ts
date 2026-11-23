import 'server-only';
import type postgres from 'postgres';
import { limitsFor, type Plan, type PlanSettings } from '@/lib/plans';
import { isTimeZone } from '@/lib/preferences';
import { suggestAddress } from '@/lib/workspace-address';
import type { Role } from '@/lib/roles';
import { randomId } from './crypto';
import { AppError } from './errors';
import { assertRoom, planSettings } from './plans';
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
 * from the name. In hosted mode it starts on the Free plan, and a person may own only so many
 * Free workspaces; the user's row is locked while they are counted, so two tabs cannot both
 * create one.
 */
export async function createWorkspace(
  sql: postgres.Sql,
  input: { name: string; userId: string; slug?: string | undefined; plan?: Plan },
  settings: PlanSettings = planSettings(),
): Promise<Workspace & { plan: Plan }> {
  const name = cleanWorkspaceName(input.name);
  const plan = input.plan ?? (settings.mode === 'hosted' ? 'free' : 'unlimited');
  try {
    return await sql.begin(async (tx) => {
      const max = limitsFor(plan, settings).ownedWorkspaces;
      if (max !== null) {
        await tx`select 1 from auth_users where id = ${input.userId} for update`;
        const [owned] = await tx<{ n: number }[]>`
          select count(*)::int as n from app_members m join app_workspaces w on w.id = m.workspace_id
          where m.user_id = ${input.userId} and m.role = 'owner' and w.plan = ${plan}`;
        assertRoom({ plan, limits: limitsFor(plan, settings) }, 'ownedWorkspaces', owned?.n ?? 0);
      }
      const slug = input.slug ?? (await addressFromName(tx, name));
      await lockAddresses(tx, [slug]);
      await assertAddressFree(tx, slug, null);
      await claimAddress(tx, slug);
      const id = randomId('ws');
      await tx`insert into app_workspaces (id, slug, name, created_by, plan)
        values (${id}, ${slug}, ${name}, ${input.userId}, ${plan})`;
      await tx`insert into app_members (workspace_id, user_id, role)
        values (${id}, ${input.userId}, 'owner')`;
      await tx`insert into app_brand_settings (workspace_id) values (${id})`;
      return { id, slug, name, plan };
    });
  } catch (err) {
    if (isSlugConflict(err)) {
      throw new AppError('CONFLICT', 'Someone just took this address. Try another one.', 'slug');
    }
    throw err;
  }
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
