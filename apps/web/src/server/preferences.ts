import 'server-only';
import type postgres from 'postgres';
import { isTheme, isTimeZone, type Preferences } from '@/lib/preferences';
import { AppError } from './errors';

export async function getPreferences(sql: postgres.Sql, userId: string): Promise<Preferences> {
  const [row] = await sql<
    { theme: Preferences['theme']; timezone: string | null; locale: string }[]
  >`
    select theme, timezone, locale from app_user_preferences where user_id = ${userId}`;
  return {
    theme: row?.theme ?? 'system',
    timezone: row?.timezone ?? null,
    locale: row?.locale ?? 'en',
  };
}

export async function updatePreferences(
  sql: postgres.Sql,
  userId: string,
  patch: { theme?: string; timezone?: string },
): Promise<Preferences> {
  // An empty zone means "follow my device": nothing is stored and the browser's zone is used.
  if (patch.theme !== undefined && !isTheme(patch.theme)) {
    throw new AppError('VALIDATION', 'Pick system, light or dark', 'theme');
  }
  if (patch.timezone && !isTimeZone(patch.timezone)) {
    throw new AppError('VALIDATION', 'Pick a time zone from the list', 'timezone');
  }
  await sql`
    insert into app_user_preferences (user_id, theme, timezone)
    values (${userId}, ${patch.theme ?? 'system'}, ${patch.timezone || null})
    on conflict (user_id) do update set
      theme = ${patch.theme === undefined ? sql`app_user_preferences.theme` : sql`excluded.theme`},
      timezone = ${patch.timezone === undefined ? sql`app_user_preferences.timezone` : sql`excluded.timezone`},
      updated_at = now()`;
  return getPreferences(sql, userId);
}
