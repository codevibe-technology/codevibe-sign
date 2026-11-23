import 'server-only';
import type postgres from 'postgres';
import { randomId, randomSecret, sha256Hex } from './crypto';
import { AppError } from './errors';
import { userLabel } from './profile';

export const API_KEY_PREFIX = 'cvs_';
const KEY_SHAPE = /^cvs_[A-Za-z0-9_-]{43}$/;
const LAST_USED_RESOLUTION_MS = 60_000;

export interface ApiKeyRecord {
  id: string;
  name: string;
  /** The first characters of the key, so people can tell keys apart. Not secret. */
  prefix: string;
  createdAt: Date;
  createdByName: string | null;
  lastUsedAt: Date | null;
}

export function cleanKeyName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) throw new AppError('VALIDATION', 'Name the key after what will use it', 'name');
  if (clean.length > 60)
    throw new AppError('VALIDATION', 'Keep the name under 60 characters', 'name');
  return clean;
}

/** Creates a key and returns it in full. This is the only time the full key exists. */
export async function createApiKey(
  sql: postgres.Sql,
  input: { workspaceId: string; name: string; createdBy: string },
): Promise<{ id: string; key: string; prefix: string }> {
  const name = cleanKeyName(input.name);
  const key = `${API_KEY_PREFIX}${randomSecret()}`;
  const id = randomId('key');
  const prefix = key.slice(0, 10);
  await sql`insert into app_api_keys (id, workspace_id, name, key_hash, prefix, created_by)
    values (${id}, ${input.workspaceId}, ${name}, ${sha256Hex(key)}, ${prefix}, ${input.createdBy})`;
  return { id, key, prefix };
}

export async function listApiKeys(sql: postgres.Sql, workspaceId: string): Promise<ApiKeyRecord[]> {
  return sql<ApiKeyRecord[]>`
    select k.id, k.name, k.prefix, k.created_at as "createdAt", ${userLabel(sql)} as "createdByName",
      k.last_used_at as "lastUsedAt"
    from app_api_keys k left join auth_users u on u.id = k.created_by
    where k.workspace_id = ${workspaceId} and k.revoked_at is null
    order by k.created_at desc`;
}

export async function revokeApiKey(sql: postgres.Sql, workspaceId: string, keyId: string) {
  const rows = await sql`update app_api_keys set revoked_at = now()
    where id = ${keyId} and workspace_id = ${workspaceId} and revoked_at is null
    returning id`;
  if (rows.length === 0) throw new AppError('NOT_FOUND', 'That key was already revoked');
}

/**
 * The workspace a presented key acts in, or null for anything that is not a live key. Only
 * the hash is looked up; the lookup is by unique index, so it reveals nothing about other keys.
 */
export async function resolveApiKey(
  sql: postgres.Sql,
  presented: string,
  now = new Date(),
): Promise<{ id: string; workspaceId: string } | null> {
  if (!KEY_SHAPE.test(presented)) return null;
  const [row] = await sql<{ id: string; workspace_id: string; last_used_at: Date | null }[]>`
    select id, workspace_id, last_used_at from app_api_keys
    where key_hash = ${sha256Hex(presented)} and revoked_at is null`;
  if (!row) return null;
  if (!row.last_used_at || now.getTime() - row.last_used_at.getTime() > LAST_USED_RESOLUTION_MS) {
    await sql`update app_api_keys set last_used_at = ${now} where id = ${row.id}`;
  }
  return { id: row.id, workspaceId: row.workspace_id };
}
