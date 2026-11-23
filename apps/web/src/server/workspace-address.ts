import 'server-only';
import type postgres from 'postgres';
import {
  ADDRESS_CHANGE_WINDOW_DAYS,
  ADDRESS_CHANGES_PER_WINDOW,
  ADDRESS_COOL_DOWN_DAYS,
  addressAlternatives,
  checkAddressFormat,
  RESERVED_ADDRESSES,
} from '@/lib/workspace-address';
import { randomId } from './crypto';
import { AppError } from './errors';

type Sql = postgres.Sql | postgres.TransactionSql;

export type AddressStatus = 'available' | 'current' | 'taken' | 'invalid';

export interface AddressAnswer {
  slug: string;
  status: AddressStatus;
  message: string;
  suggestions: string[];
}

/**
 * Takes a lock per address for the rest of the transaction, so two people claiming or
 * releasing the same address are served one after the other. Sorted, so two transactions that
 * lock the same pair cannot wait on each other.
 */
export async function lockAddresses(tx: postgres.TransactionSql, slugs: string[]) {
  for (const slug of [...new Set(slugs)].sort()) {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`cvs.workspace-address:${slug}`}, 0))`;
  }
}

/**
 * The addresses in `slugs` that nobody can take now: a workspace uses it, or another workspace
 * gave it up less than the cool-down ago. `workspaceId` may take back its own old addresses.
 */
export async function unavailableAddresses(
  sql: Sql,
  slugs: string[],
  workspaceId: string | null = null,
): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await sql<{ slug: string }[]>`
    select slug from app_workspaces where slug in ${sql(slugs)}
    union
    select slug from app_workspace_slug_history
    where slug in ${sql(slugs)}
      and workspace_id is distinct from ${workspaceId}
      and retired_at > now() - make_interval(days => ${ADDRESS_COOL_DOWN_DAYS})`;
  return new Set(rows.map((row) => row.slug));
}

/** Up to `count` free addresses close to `base`. */
export async function freeAlternatives(
  sql: Sql,
  base: string,
  workspaceId: string | null = null,
  count = 3,
): Promise<string[]> {
  const candidates = addressAlternatives(base, 12).filter((slug) => !RESERVED_ADDRESSES.has(slug));
  const taken = await unavailableAddresses(sql, candidates, workspaceId);
  return candidates.filter((slug) => !taken.has(slug)).slice(0, count);
}

const takenMessage = (suggestions: string[]) =>
  suggestions[0]
    ? `This address is taken. Try ${suggestions[0]}.`
    : 'This address is taken. Try another one.';

/**
 * What the address box shows while someone types. A recently retired address answers
 * "taken" like one in use, so the answer says nothing about other workspaces' history.
 */
export async function checkAddress(
  sql: Sql,
  slug: string,
  workspace: { id: string; slug: string } | null = null,
): Promise<AddressAnswer> {
  if (workspace && slug === workspace.slug) {
    return { slug, status: 'current', message: 'This is the address now.', suggestions: [] };
  }
  const format = checkAddressFormat(slug);
  if (!format.ok) {
    const suggestions =
      format.problem === 'reserved' ? await freeAlternatives(sql, slug, workspace?.id) : [];
    return { slug, status: 'invalid', message: format.message, suggestions };
  }
  const taken = await unavailableAddresses(sql, [slug], workspace?.id ?? null);
  if (!taken.has(slug)) return { slug, status: 'available', message: 'Available', suggestions: [] };
  const suggestions = await freeAlternatives(sql, slug, workspace?.id);
  return { slug, status: 'taken', message: takenMessage(suggestions), suggestions };
}

/**
 * Throws the field error the form shows when `slug` cannot be claimed by `workspaceId` (null
 * for a workspace being created). Call it inside the transaction, after `lockAddresses`.
 */
export async function assertAddressFree(
  tx: postgres.TransactionSql,
  slug: string,
  workspaceId: string | null,
) {
  const format = checkAddressFormat(slug);
  if (!format.ok) throw new AppError('VALIDATION', format.message, 'slug');
  const taken = await unavailableAddresses(tx, [slug], workspaceId);
  if (taken.has(slug)) {
    throw new AppError(
      'CONFLICT',
      takenMessage(await freeAlternatives(tx, slug, workspaceId)),
      'slug',
    );
  }
}

/** Whether a Postgres error is the unique index on `app_workspaces.slug`. */
export function isSlugConflict(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, constraint_name: constraint } = err as { code?: string; constraint_name?: string };
  return code === '23505' && (constraint === undefined || constraint === 'app_workspaces_slug_key');
}

/** Gives `slug` to a workspace: it is no longer an old address of anyone's. */
export async function claimAddress(tx: postgres.TransactionSql, slug: string) {
  await tx`delete from app_workspace_slug_history where slug = ${slug}`;
}

export interface AddressChange {
  from: string;
  to: string;
}

/**
 * Moves a workspace to a new address. The old one is kept as a redirect to this workspace
 * and no other workspace can take it during the cool-down. Every change is recorded.
 */
export async function changeWorkspaceAddress(
  sql: postgres.Sql,
  input: { workspaceId: string; slug: string; userId: string },
): Promise<AddressChange> {
  const to = input.slug;
  const format = checkAddressFormat(to);
  if (!format.ok) throw new AppError('VALIDATION', format.message, 'slug');
  try {
    return await sql.begin(async (tx) => {
      const [row] = await tx<{ slug: string }[]>`
        select slug from app_workspaces where id = ${input.workspaceId} for update`;
      if (!row) throw new AppError('NOT_FOUND', 'Workspace not found');
      const from = row.slug;
      if (from === to) {
        throw new AppError('VALIDATION', 'This is the address now. Type a new one.', 'slug');
      }
      const [recent] = await tx<{ n: number; first: Date | null }[]>`
        select count(*)::int as n, min(created_at) as first from app_workspace_address_changes
        where workspace_id = ${input.workspaceId}
          and created_at > now() - make_interval(days => ${ADDRESS_CHANGE_WINDOW_DAYS})`;
      if (recent && recent.n >= ADDRESS_CHANGES_PER_WINDOW && recent.first) {
        const next = new Date(recent.first.getTime() + ADDRESS_CHANGE_WINDOW_DAYS * 86_400_000);
        throw new AppError(
          'CONFLICT',
          `The address was changed ${recent.n} times in ${ADDRESS_CHANGE_WINDOW_DAYS} days. You can change it again from ${next.toISOString().slice(0, 10)}.`,
          'slug',
        );
      }
      await lockAddresses(tx, [from, to]);
      await assertAddressFree(tx, to, input.workspaceId);
      await claimAddress(tx, to);
      await tx`update app_workspaces set slug = ${to}, updated_at = now()
        where id = ${input.workspaceId}`;
      await tx`insert into app_workspace_slug_history (slug, workspace_id, retired_at)
        values (${from}, ${input.workspaceId}, now())
        on conflict (slug) do update
          set workspace_id = excluded.workspace_id, retired_at = excluded.retired_at`;
      await tx`insert into app_workspace_address_changes
          (id, workspace_id, from_slug, to_slug, changed_by)
        values (${randomId('wsa')}, ${input.workspaceId}, ${from}, ${to}, ${input.userId})`;
      return { from, to };
    });
  } catch (err) {
    if (isSlugConflict(err)) {
      throw new AppError('CONFLICT', 'Someone just took this address. Try another one.', 'slug');
    }
    throw err;
  }
}

/**
 * The address a member should be sent to when they open an old address of a workspace they
 * belong to; null otherwise, so outsiders learn nothing about where a workspace went.
 */
export async function movedAddress(sql: Sql, userId: string, slug: string): Promise<string | null> {
  const [row] = await sql<{ slug: string }[]>`
    select w.slug from app_workspace_slug_history h
    join app_workspaces w on w.id = h.workspace_id
    join app_members m on m.workspace_id = w.id and m.user_id = ${userId}
    where h.slug = ${slug}`;
  return row?.slug ?? null;
}

export interface PastAddress {
  slug: string;
  retiredAt: Date;
}

/** The old addresses that still lead to this workspace, newest first. */
export async function pastAddresses(sql: Sql, workspaceId: string): Promise<PastAddress[]> {
  const rows = await sql<{ slug: string; retired_at: Date }[]>`
    select slug, retired_at from app_workspace_slug_history
    where workspace_id = ${workspaceId}
    order by retired_at desc
    limit 20`;
  return rows.map((row) => ({ slug: row.slug, retiredAt: row.retired_at }));
}

/**
 * `path` with the workspace's old address swapped for its new one, when `path` is an app path
 * under the old address; otherwise the workspace's home.
 */
export function movedPath(path: string | null, from: string, to: string): string {
  const prefix = `/dashboard/${from}`;
  if (path && path.startsWith(prefix)) {
    const rest = path.slice(prefix.length);
    if (rest === '' || rest.startsWith('/') || rest.startsWith('?')) {
      return `/dashboard/${to}${rest}`;
    }
  }
  return `/dashboard/${to}`;
}
