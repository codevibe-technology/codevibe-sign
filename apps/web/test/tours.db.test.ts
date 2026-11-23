import { randomUUID } from 'node:crypto';
import { migrate as migrateSignServer } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMigrations } from '@/server/db/migrations';
import { AppError } from '@/server/errors';
import { migrateAll } from '@/server/migrate';
import { getTours, recordTour } from '@/server/tours';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('guided tours, against PostgreSQL', () => {
  const schema = `tours_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  async function person() {
    const id = randomUUID();
    await sql`insert into auth_users (id, name, email)
      values (${id}, 'Asha', ${`a-${id.slice(0, 8)}@example.com`})`;
    return id;
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 2, onnotice: () => {}, connection: { search_path: schema } });
    // An install from before the tours, with people already using it.
    await migrateSignServer(sql);
    await sql`create table app_migrations (
      name text primary key, applied_at timestamptz not null default now())`;
    for (const migration of appMigrations) {
      if (migration.name >= '0023_user_tours') break;
      await sql.unsafe(migration.sql);
      await sql`insert into app_migrations (name) values (${migration.name})`;
    }
    await sql`insert into auth_users (id, name, email)
      values ('user_before', 'Ravi', 'ravi@example.com')`;
    await migrateAll(sql);
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  it('keeps both tours closed for people who were members before they shipped', async () => {
    expect(await getTours(sql, 'user_before')).toEqual({ workspace: 'skipped', send: 'skipped' });
  });

  it('opens both tours for someone who joins later', async () => {
    expect(await getTours(sql, await person())).toEqual({});
  });

  it('keeps the latest run of a tour for that person only', async () => {
    const asha = await person();
    const mia = await person();
    await recordTour(sql, asha, 'workspace', 'started');
    await recordTour(sql, asha, 'workspace', 'done');
    await recordTour(sql, asha, 'send', 'skipped');
    expect(await getTours(sql, asha)).toEqual({ workspace: 'done', send: 'skipped' });
    expect(await getTours(sql, mia)).toEqual({});
  });

  it('refuses a tour or status it does not know and saves nothing', async () => {
    const zoe = await person();
    for (const [tour, status, field] of [
      ['signer', 'done', 'tour'],
      ['send', 'finished', 'status'],
    ] as const) {
      const err = await recordTour(sql, zoe, tour, status).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).field).toBe(field);
    }
    expect(await getTours(sql, zoe)).toEqual({});
  });

  it('ignores a row for a tour this build no longer has', async () => {
    const leo = await person();
    await sql`insert into app_user_tours (user_id, tour, status) values (${leo}, 'old', 'done')`;
    expect(await getTours(sql, leo)).toEqual({});
  });

  it('goes with the account when the person is deleted', async () => {
    const gone = await person();
    await recordTour(sql, gone, 'send', 'done');
    await sql`delete from auth_users where id = ${gone}`;
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from app_user_tours where user_id = ${gone}`;
    expect(row!.n).toBe(0);
  });
});
