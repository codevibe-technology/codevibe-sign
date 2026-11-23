import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanSettings } from '@/lib/plans';
import { AppError } from '@/server/errors';
import { migrateAll } from '@/server/migrate';
import {
  changeWorkspaceAddress,
  checkAddress,
  movedAddress,
  pastAddresses,
} from '@/server/workspace-address';
import { createWorkspace, findMembership } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const settings: PlanSettings = { mode: 'self-hosted', freeOverrides: {} };

async function failure(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe.skipIf(!url)('workspace addresses against PostgreSQL', () => {
  const schema = `web_address_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let run = 0;
  /** A slug unique to this test run, so parallel runs never meet. */
  const unique = (base: string) => `${base}-${process.pid % 1000}x${++run}`;

  async function user(name = 'Asha') {
    const id = randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id };
  }

  async function workspace(slug: string) {
    const owner = await user();
    const ws = await createWorkspace(sql, { name: 'Acme', userId: owner.id, slug }, settings);
    return { ...ws, owner };
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0010_workspace_addresses');
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  describe('creating', () => {
    it('uses the chosen address', async () => {
      const slug = unique('acme-hr');
      const ws = await workspace(slug);
      expect(ws.slug).toBe(slug);
    });

    it('refuses a reserved or malformed address with a field error', async () => {
      const owner = await user();
      for (const slug of ['dashboard', 'api', 'Acme', 'a', 'acme--hr', '-acme']) {
        const err = await failure(
          createWorkspace(sql, { name: 'Acme', userId: owner.id, slug }, settings),
        );
        expect(err.code).toBe('VALIDATION');
        expect(err.field).toBe('slug');
      }
    });

    it('refuses a taken address and names a free one', async () => {
      const slug = unique('codevibe');
      await workspace(slug);
      const owner = await user();
      const err = await failure(
        createWorkspace(sql, { name: 'Codevibe', userId: owner.id, slug }, settings),
      );
      expect(err).toMatchObject({ code: 'CONFLICT', field: 'slug' });
      expect(err.message).toBe(`This address is taken. Try ${slug}-2.`);
    });

    it('still makes an address from the name when none is given', async () => {
      const owner = await user();
      const a = await createWorkspace(sql, { name: 'Zeta Works', userId: owner.id }, settings);
      const b = await createWorkspace(sql, { name: 'Zeta Works', userId: owner.id }, settings);
      expect(a.slug).toBe('zeta-works');
      expect(b.slug).toBe('zeta-works-2');
      const c = await createWorkspace(sql, { name: 'Settings', userId: owner.id }, settings);
      expect(c.slug).toBe('settings-workspace');
    });

    it('lets exactly one of two people claim the same address at once', async () => {
      const slug = unique('race');
      const [one, two] = await Promise.all([user('One'), user('Two')]);
      const results = await Promise.allSettled([
        createWorkspace(sql, { name: 'One', userId: one.id, slug }, settings),
        createWorkspace(sql, { name: 'Two', userId: two.id, slug }, settings),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      const reason = (lost[0] as PromiseRejectedResult).reason as AppError;
      expect(reason).toBeInstanceOf(AppError);
      expect(reason).toMatchObject({ code: 'CONFLICT', field: 'slug' });
      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from app_workspaces where slug = ${slug}`;
      expect(count?.n).toBe(1);
    });
  });

  describe('changing', () => {
    it('moves the workspace, keeps the old address as a redirect and records the change', async () => {
      const from = unique('old-name');
      const to = unique('new-name');
      const ws = await workspace(from);
      expect(
        await changeWorkspaceAddress(sql, { workspaceId: ws.id, slug: to, userId: ws.owner.id }),
      ).toEqual({ from, to });
      expect(await findMembership(sql, ws.owner.id, { slug: to })).toMatchObject({
        workspace: { id: ws.id, slug: to },
      });
      expect(await findMembership(sql, ws.owner.id, { slug: from })).toBeNull();
      expect(await movedAddress(sql, ws.owner.id, from)).toBe(to);
      expect((await pastAddresses(sql, ws.id)).map((p) => p.slug)).toEqual([from]);
      const audit = await sql`
        select from_slug, to_slug, changed_by from app_workspace_address_changes
        where workspace_id = ${ws.id}`;
      expect(audit).toEqual([{ from_slug: from, to_slug: to, changed_by: ws.owner.id }]);
    });

    it('follows a chain of changes to the newest address', async () => {
      const [a, b, c] = [unique('chain-a'), unique('chain-b'), unique('chain-c')];
      const ws = await workspace(a);
      await changeWorkspaceAddress(sql, { workspaceId: ws.id, slug: b, userId: ws.owner.id });
      await changeWorkspaceAddress(sql, { workspaceId: ws.id, slug: c, userId: ws.owner.id });
      expect(await movedAddress(sql, ws.owner.id, a)).toBe(c);
      expect(await movedAddress(sql, ws.owner.id, b)).toBe(c);
    });

    it('tells outsiders nothing about where a workspace went', async () => {
      const from = unique('private');
      const ws = await workspace(from);
      await changeWorkspaceAddress(sql, {
        workspaceId: ws.id,
        slug: unique('private-new'),
        userId: ws.owner.id,
      });
      const stranger = await user('Stranger');
      expect(await movedAddress(sql, stranger.id, from)).toBeNull();
    });

    it('keeps the old address from other workspaces for the cool-down, then frees it', async () => {
      const from = unique('cooling');
      const ws = await workspace(from);
      await changeWorkspaceAddress(sql, {
        workspaceId: ws.id,
        slug: unique('cooled'),
        userId: ws.owner.id,
      });
      const other = await user('Other');
      expect(await checkAddress(sql, from)).toMatchObject({ status: 'taken' });
      const err = await failure(
        createWorkspace(sql, { name: 'Other', userId: other.id, slug: from }, settings),
      );
      expect(err).toMatchObject({ code: 'CONFLICT', field: 'slug' });

      await sql`update app_workspace_slug_history set retired_at = now() - interval '91 days'
        where slug = ${from}`;
      expect(await checkAddress(sql, from)).toMatchObject({ status: 'available' });
      const claimed = await createWorkspace(
        sql,
        { name: 'Other', userId: other.id, slug: from },
        settings,
      );
      expect(claimed.slug).toBe(from);
      expect(await movedAddress(sql, ws.owner.id, from)).toBeNull();
      expect(await pastAddresses(sql, ws.id)).toEqual([]);
    });

    it('lets a workspace take back its own old address at any time', async () => {
      const from = unique('back');
      const to = unique('away');
      const ws = await workspace(from);
      await changeWorkspaceAddress(sql, { workspaceId: ws.id, slug: to, userId: ws.owner.id });
      expect(await checkAddress(sql, from, { id: ws.id, slug: to })).toMatchObject({
        status: 'available',
      });
      await changeWorkspaceAddress(sql, { workspaceId: ws.id, slug: from, userId: ws.owner.id });
      expect(await movedAddress(sql, ws.owner.id, to)).toBe(from);
      expect((await pastAddresses(sql, ws.id)).map((p) => p.slug)).toEqual([to]);
    });

    it('refuses a taken, reserved or unchanged address with a field error', async () => {
      const taken = unique('taken');
      await workspace(taken);
      const ws = await workspace(unique('mine'));
      const change = (slug: string) =>
        failure(changeWorkspaceAddress(sql, { workspaceId: ws.id, slug, userId: ws.owner.id }));
      expect(await change(taken)).toMatchObject({ code: 'CONFLICT', field: 'slug' });
      expect(await change('admin')).toMatchObject({ code: 'VALIDATION', field: 'slug' });
      expect(await change(ws.slug)).toMatchObject({ code: 'VALIDATION', field: 'slug' });
    });

    it('lets one of two workspaces move to the same address at once', async () => {
      const target = unique('contested');
      const a = await workspace(unique('contest-a'));
      const b = await workspace(unique('contest-b'));
      const results = await Promise.allSettled([
        changeWorkspaceAddress(sql, { workspaceId: a.id, slug: target, userId: a.owner.id }),
        changeWorkspaceAddress(sql, { workspaceId: b.id, slug: target, userId: b.owner.id }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: 'CONFLICT', field: 'slug' });
    });

    it('never hands an address being given up to a new workspace at the same moment', async () => {
      for (let i = 0; i < 5; i++) {
        const from = unique('handover');
        const ws = await workspace(from);
        const other = await user('Other');
        const [moved, created] = await Promise.allSettled([
          changeWorkspaceAddress(sql, {
            workspaceId: ws.id,
            slug: unique('handover-new'),
            userId: ws.owner.id,
          }),
          createWorkspace(sql, { name: 'Other', userId: other.id, slug: from }, settings),
        ]);
        expect(moved.status).toBe('fulfilled');
        expect(created.status).toBe('rejected');
        expect(await movedAddress(sql, ws.owner.id, from)).not.toBeNull();
      }
    });

    it('limits how often the address can change', async () => {
      const ws = await workspace(unique('busy'));
      for (let i = 0; i < 5; i++) {
        await changeWorkspaceAddress(sql, {
          workspaceId: ws.id,
          slug: unique('busy-step'),
          userId: ws.owner.id,
        });
      }
      const err = await failure(
        changeWorkspaceAddress(sql, {
          workspaceId: ws.id,
          slug: unique('busy-last'),
          userId: ws.owner.id,
        }),
      );
      expect(err).toMatchObject({ code: 'CONFLICT', field: 'slug' });
      expect(err.message).toMatch(/You can change it again from \d{4}-\d{2}-\d{2}\./);
    });

    it('keeps ids, so keys and webhooks that point at the workspace are untouched', async () => {
      const ws = await workspace(unique('ids'));
      await sql`insert into app_api_keys (id, workspace_id, name, key_hash, prefix)
        values (${`key_${run}`}, ${ws.id}, 'HR', ${`hash-${randomUUID()}`}, 'cvs_x')`;
      await changeWorkspaceAddress(sql, {
        workspaceId: ws.id,
        slug: unique('ids-new'),
        userId: ws.owner.id,
      });
      const keys = await sql`select workspace_id from app_api_keys where workspace_id = ${ws.id}`;
      expect(keys).toHaveLength(1);
    });
  });

  describe('checking', () => {
    it('answers available, taken with free alternatives, reserved and current', async () => {
      const slug = unique('check');
      const ws = await workspace(slug);
      await workspace(`${slug}-2`);
      expect(await checkAddress(sql, unique('free'))).toMatchObject({ status: 'available' });
      const taken = await checkAddress(sql, slug);
      expect(taken).toMatchObject({ status: 'taken' });
      expect(taken.suggestions[0]).toBe(`${slug}-3`);
      expect(taken.message).toBe(`This address is taken. Try ${slug}-3.`);
      const reserved = await checkAddress(sql, 'dashboard');
      expect(reserved).toMatchObject({ status: 'invalid' });
      expect(reserved.suggestions[0]).toBe('dashboard-2');
      expect(await checkAddress(sql, slug, ws)).toMatchObject({ status: 'current' });
    });
  });
});
