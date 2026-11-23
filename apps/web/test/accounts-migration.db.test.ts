import { randomUUID } from 'node:crypto';
import { migrate as migrateSignServer } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMigrations } from '@/server/db/migrations';
import { migrateAll } from '@/server/migrate';

const url = process.env.DATABASE_URL;

/**
 * An install as it stands before accounts: workspaces with a plan each, owned, shared and
 * left behind. The migration has to give every one of them an account without losing a plan.
 */
describe.skipIf(!url)('moving existing workspaces onto accounts', () => {
  const schema = `acct_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  const people = ['asha', 'ravi', 'mia', 'zoe', 'gone'] as const;
  const id = (name: string) => `user_${name}`;

  async function workspace(
    slug: string,
    plan: 'free' | 'cloud' | 'unlimited',
    createdBy: string | null,
    members: [string, string][],
  ) {
    await sql`insert into app_workspaces (id, slug, name, created_by, plan)
      values (${`ws_${slug}`}, ${slug}, ${slug}, ${createdBy}, ${plan})`;
    let minute = 0;
    for (const [user, role] of members) {
      await sql`insert into app_members (workspace_id, user_id, role, created_at)
        values (${`ws_${slug}`}, ${id(user)}, ${role}, ${new Date(Date.UTC(2026, 0, 1, 0, minute++))})`;
    }
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 2, onnotice: () => {}, connection: { search_path: schema } });
    await migrateSignServer(sql);
    await sql`create table app_migrations (
      name text primary key, applied_at timestamptz not null default now())`;
    for (const migration of appMigrations) {
      if (migration.name > '0012_z') break;
      await sql.unsafe(migration.sql);
      await sql`insert into app_migrations (name) values (${migration.name})`;
    }
    for (const name of people) {
      await sql`insert into auth_users (id, name, email)
        values (${id(name)}, ${name}, ${`${name}@example.com`})`;
    }
    // Asha created three Free workspaces and still owns them.
    await workspace('asha-one', 'free', id('asha'), [['asha', 'owner']]);
    await workspace('asha-two', 'free', id('asha'), [
      ['asha', 'owner'],
      ['mia', 'member'],
    ]);
    await workspace('asha-three', 'free', id('asha'), [['asha', 'owner']]);
    // Ravi has a Free and a Cloud one: the account takes the higher plan.
    await workspace('ravi-free', 'free', id('ravi'), [['ravi', 'owner']]);
    await workspace('ravi-cloud', 'cloud', id('ravi'), [
      ['ravi', 'owner'],
      ['asha', 'admin'],
    ]);
    // Two owners: the one who created it has it.
    await workspace('shared', 'unlimited', id('mia'), [
      ['zoe', 'owner'],
      ['mia', 'owner'],
    ]);
    // The creator stepped down: the earliest owner has it.
    await workspace('handed-over', 'free', id('asha'), [
      ['asha', 'member'],
      ['zoe', 'owner'],
    ]);
    // The creator's user is gone and nobody is an owner: the earliest admin has it.
    await workspace('no-owner', 'cloud', null, [
      ['mia', 'member'],
      ['zoe', 'admin'],
    ]);
    // Nobody at all.
    await workspace('empty', 'free', null, []);
    // Nobody is in it any more, though whoever created it still has a login.
    await workspace('abandoned', 'free', id('asha'), []);
    await sql`insert into app_plan_changes (id, workspace_id, from_plan, to_plan, changed_by)
      values ('plan_old', 'ws_ravi-cloud', 'free', 'cloud', 'operator')`;
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  it('gives every workspace an account and every owner exactly one', async () => {
    const applied = await migrateAll(sql);
    expect(applied).toContain('app/0013_accounts');
    const rows = await sql<{ slug: string; owner: string | null; plan: string; source: string }[]>`
      select w.slug, u.name as owner, a.plan, a.plan_source as source
      from app_workspaces w join app_accounts a on a.id = w.account_id
      left join auth_users u on u.id = a.owner_user_id
      order by w.slug`;
    const byslug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(byslug['asha-one']).toMatchObject({ owner: 'asha', plan: 'free' });
    expect(byslug['asha-two']).toMatchObject({ owner: 'asha', plan: 'free' });
    expect(byslug['asha-three']).toMatchObject({ owner: 'asha', plan: 'free' });
    expect(byslug['ravi-free']).toMatchObject({ owner: 'ravi', plan: 'cloud' });
    expect(byslug['ravi-cloud']).toMatchObject({ owner: 'ravi', plan: 'cloud' });
    expect(byslug.shared).toMatchObject({ owner: 'mia', plan: 'unlimited' });
    // Zoe has a Free workspace handed to her and a Cloud one she administers alone.
    expect(byslug['handed-over']).toMatchObject({ owner: 'zoe', plan: 'cloud' });
    expect(byslug['no-owner']).toMatchObject({ owner: 'zoe', plan: 'cloud' });
    expect(byslug.empty).toMatchObject({ owner: null, plan: 'free' });
    // It does not count against Asha, who could not open it.
    expect(byslug.abandoned).toMatchObject({ owner: null, plan: 'free' });
    expect(rows.every((r) => r.source === 'operator')).toBe(true);

    const [counts] = await sql<{ accounts: number; owners: number; loose: number }[]>`
      select
        (select count(*)::int from app_accounts) as accounts,
        (select count(distinct owner_user_id)::int from app_accounts) as owners,
        (select count(*)::int from app_workspaces where account_id is null) as loose`;
    expect(counts).toEqual({ accounts: 6, owners: 4, loose: 0 });
  });

  it('makes whoever got the account an owner, and files old plan changes under it', async () => {
    const [zoe] = await sql<{ role: string }[]>`
      select role from app_members where workspace_id = 'ws_no-owner' and user_id = ${id('zoe')}`;
    expect(zoe!.role).toBe('owner');
    const [mia] = await sql<{ role: string }[]>`
      select role from app_members where workspace_id = 'ws_no-owner' and user_id = ${id('mia')}`;
    expect(mia!.role).toBe('member');
    const [change] = await sql<{ account_id: string; expected: string }[]>`
      select c.account_id, w.account_id as expected
      from app_plan_changes c join app_workspaces w on w.id = c.workspace_id
      where c.id = 'plan_old'`;
    expect(change!.account_id).toBe(change!.expected);
  });

  it('refuses to start on a database an unreleased build already changed', async () => {
    await sql`insert into app_migrations (name) values ('0013_billing')`;
    await expect(migrateAll(sql)).rejects.toThrow(/unreleased build.*0013_billing/);
    await sql`delete from app_migrations where name = '0013_billing'`;
    expect(await migrateAll(sql)).not.toContain('app/0013_accounts');
  });

  it('keeps a Free owner of several workspaces working but refuses another', async () => {
    const { createWorkspace } = await import('@/server/workspaces');
    const { workspacePlan, usageReport } = await import('@/server/plans');
    const hosted = { mode: 'hosted' as const, freeOverrides: {} };
    for (const slug of ['asha-one', 'asha-two', 'asha-three']) {
      expect((await workspacePlan(sql, `ws_${slug}`, hosted)).plan).toBe('free');
    }
    const report = await usageReport(sql, 'ws_asha-two', hosted);
    expect(report.lines.find((l) => l.key === 'ownedWorkspaces')).toMatchObject({
      used: 3,
      max: 1,
    });
    expect(report.lines.find((l) => l.key === 'members')).toMatchObject({ used: 2 });
    expect(report.workspaces).toHaveLength(3);
    await expect(
      createWorkspace(sql, { name: 'Fourth', userId: id('asha') }, hosted),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT', limit: 'ownedWorkspaces', used: 3, max: 1 });
    // Ravi's account came out on Cloud, so it can take more.
    const more = await createWorkspace(sql, { name: 'Ravi more', userId: id('ravi') }, hosted);
    expect(more.plan).toBe('cloud');
  });

  it('gives someone without a workspace an account when they create their first', async () => {
    const { createWorkspace } = await import('@/server/workspaces');
    const hosted = { mode: 'hosted' as const, freeOverrides: {} };
    const made = await createWorkspace(sql, { name: 'Gone first', userId: id('gone') }, hosted);
    expect(made.plan).toBe('free');
    const [row] = await sql<{ owner_user_id: string }[]>`
      select owner_user_id from app_accounts where id = ${made.accountId}`;
    expect(row?.owner_user_id).toBe(id('gone'));
  });
});
