import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@/server/errors';
import { migrateAll } from '@/server/migrate';
import { setOwnName } from '@/server/profile';

const url = process.env.DATABASE_URL;

async function rejectsWith(promise: Promise<unknown>, code: string, field?: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (field) expect((err as AppError).field).toBe(field);
}

describe.skipIf(!url)('names, against PostgreSQL', () => {
  const schema = `web_names_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  async function person(name: string) {
    const id = randomUUID();
    const email = `p-${id.slice(0, 8)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id, email };
  }

  const nameOf = async (id: string) =>
    (await sql<{ name: string }[]>`select name from auth_users where id = ${id}`)[0]?.name;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    await migrateAll(sql);
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  describe('setOwnName', () => {
    it('saves the tidied name on that account and no other', async () => {
      const ravi = await person('');
      const mia = await person('Mia');
      expect(await setOwnName(sql, ravi.id, '  शुभम   कुमार ')).toBe('शुभम कुमार');
      expect(await nameOf(ravi.id)).toBe('शुभम कुमार');
      expect(await nameOf(mia.id)).toBe('Mia');
    });

    it('stores a name that looks like SQL or markup as plain text', async () => {
      const zoe = await person('');
      const odd = "Robert'); drop table auth_users;-- <b>";
      expect(await setOwnName(sql, zoe.id, odd)).toBe(odd);
      expect(await nameOf(zoe.id)).toBe(odd);
    });

    it('refuses names that break the rule and leaves the saved one alone', async () => {
      const asha = await person('Asha');
      for (const bad of ['', '  ', 'A', 'a'.repeat(81), 'As\u0000ha']) {
        await rejectsWith(setOwnName(sql, asha.id, bad), 'VALIDATION', 'name');
      }
      expect(await nameOf(asha.id)).toBe('Asha');
      await rejectsWith(setOwnName(sql, 'no-such-user', 'Asha Rao'), 'NOT_FOUND');
    });
  });
});
