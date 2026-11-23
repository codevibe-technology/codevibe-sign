import 'server-only';
import type postgres from 'postgres';
import { z } from 'zod';
import { PERSON_NAME_MAX, parsePersonName } from '@/lib/person-name';
import { AppError } from './errors';

/** A person's name in an action's input, checked and tidied by the shared rule. */
export const personNameInput = z
  .string({ error: 'Enter your name' })
  .max(PERSON_NAME_MAX * 4, `Keep the name to ${PERSON_NAME_MAX} characters or fewer`)
  .transform((raw, ctx) => {
    const result = parsePersonName(raw);
    if (result.ok) return result.name;
    ctx.addIssue({ code: 'custom', message: result.error });
    return z.NEVER;
  });

export function cleanPersonName(raw: string, field = 'name'): string {
  const result = parsePersonName(raw);
  if (!result.ok) throw new AppError('VALIDATION', result.error, field);
  return result.name;
}

/**
 * Saves a person's own name. `userId` must come from the session, never from the request:
 * this is the only way a name changes, and it changes one row.
 */
export async function setOwnName(
  sql: postgres.Sql | postgres.TransactionSql,
  userId: string,
  raw: string,
  field = 'name',
): Promise<string> {
  const name = cleanPersonName(raw, field);
  const rows = await sql`
    update auth_users set name = ${name}, updated_at = now() where id = ${userId} returning id`;
  if (rows.length === 0) throw new AppError('NOT_FOUND', 'Account not found');
  return name;
}

/**
 * For queries that join `auth_users` as `u`: the person's name, or their email address when
 * they have saved none. The SQL twin of `displayName`.
 */
export const userLabel = (sql: postgres.Sql | postgres.TransactionSql) =>
  sql`coalesce(nullif(btrim(u.name), ''), u.email)`;
