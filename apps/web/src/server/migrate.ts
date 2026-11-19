import { migrate as migrateSignServer } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import { appMigrations } from './db/migrations';

const APP_MIGRATION_LOCK = 724_001_338;

/**
 * Brings the database up to date: the sign server's tables first, then the app's. Safe to run
 * on every start and from several processes at once; applied migrations are recorded and
 * skipped, and an advisory lock serialises the runs.
 */
export async function migrateAll(sql: postgres.Sql): Promise<string[]> {
  const applied = await migrateSignServer(sql);
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${APP_MIGRATION_LOCK})`;
    await tx`create table if not exists app_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const rows = await tx<{ name: string }[]>`select name from app_migrations`;
    const done = new Set(rows.map((row) => row.name));
    for (const migration of appMigrations) {
      if (done.has(migration.name)) continue;
      await tx.unsafe(migration.sql);
      await tx`insert into app_migrations (name) values (${migration.name})`;
      applied.push(`app/${migration.name}`);
    }
  });
  return applied;
}
