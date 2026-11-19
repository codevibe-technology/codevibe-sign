import 'server-only';
import type postgres from 'postgres';
import type { Role } from '@/lib/roles';
import { randomId } from './crypto';
import { AppError } from './errors';

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

/** A URL-safe slug from a name: lower case, ASCII letters and digits, single dashes. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'workspace';
}

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

/** Creates a workspace with `userId` as its owner and default brand settings, atomically. */
export async function createWorkspace(
  sql: postgres.Sql,
  input: { name: string; userId: string },
): Promise<Workspace> {
  const name = cleanWorkspaceName(input.name);
  const base = slugify(name);
  return sql.begin(async (tx) => {
    const id = randomId('ws');
    let slug = base;
    for (let attempt = 0; ; attempt++) {
      const [taken] = await tx`select 1 from app_workspaces where slug = ${slug}`;
      if (!taken) break;
      slug = `${base}-${id.slice(-4 - attempt)}`.slice(0, 48);
    }
    await tx`insert into app_workspaces (id, slug, name, created_by)
      values (${id}, ${slug}, ${name}, ${input.userId})`;
    await tx`insert into app_members (workspace_id, user_id, role)
      values (${id}, ${input.userId}, 'owner')`;
    await tx`insert into app_brand_settings (workspace_id) values (${id})`;
    return { id, slug, name };
  });
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

export async function renameWorkspace(sql: Sql, workspaceId: string, name: string) {
  const clean = cleanWorkspaceName(name);
  await sql`update app_workspaces set name = ${clean}, updated_at = now()
    where id = ${workspaceId}`;
  return clean;
}
