import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanSettings } from '@/lib/plans';
import type { Role } from '@/lib/roles';
import { setAccountPlan } from '@/server/accounts';
import { AppError } from '@/server/errors';
import { createInvitation } from '@/server/invitations';
import { migrateAll } from '@/server/migrate';
import { PlanLimitError } from '@/server/plans';
import {
  TRANSFER_TTL_MS,
  acceptTransfer,
  cancelTransfer,
  declineTransfer,
  getTransfer,
  pendingTransferOf,
  pendingTransfersFor,
  recipientRoomProblem,
  startTransfer,
  transferHistory,
} from '@/server/transfers';
import { createWorkspace, findMembership } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const hosted: PlanSettings = { mode: 'hosted', freeOverrides: {} };
const selfHosted: PlanSettings = { mode: 'self-hosted', freeOverrides: {} };
const NOW = new Date('2026-11-23T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function failure(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe.skipIf(!url)('workspace transfers against PostgreSQL', () => {
  const schema = `web_transfer_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  async function person(name = 'Asha') {
    const id = randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id, email, name };
  }

  async function workspace(plan: 'free' | 'cloud' = 'cloud', settings = hosted) {
    const owner = await person('Owner');
    const ws = await createWorkspace(sql, { name: 'Acme', userId: owner.id, plan }, settings);
    return { ...ws, owner, actor: { userId: owner.id, role: 'owner' as Role } };
  }

  async function join(workspaceId: string, role: Role, name: string = role) {
    const user = await person(name);
    await sql`insert into app_members (workspace_id, user_id, role)
      values (${workspaceId}, ${user.id}, ${role})`;
    return user;
  }

  const roleOf = async (userId: string, workspaceId: string) =>
    (await findMembership(sql, userId, { id: workspaceId }))?.role ?? null;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: schema } });
    const applied = await migrateAll(sql);
    expect(applied).toContain('app/0020_billing_admin_role');
    expect(applied).toContain('app/0021_workspace_transfers');
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  describe('accepting', () => {
    it('moves the workspace with everything in it, and keeps the money with the payer', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'member', 'Ravi');
      const billingAdmin = await join(ws.id, 'billing', 'Meera');
      await sql`insert into app_api_keys (id, workspace_id, name, key_hash, prefix)
        values (${`key_${randomUUID()}`}, ${ws.id}, 'CI', ${randomUUID()}, 'cvs_')`;
      await sql`insert into app_esign_credits (account_id, available) values (${ws.accountId}, 40)`;

      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: NOW,
        },
        hosted,
      );
      expect(offer).toMatchObject({
        status: 'pending',
        toEmail: recipient.email,
        workspaceSlug: ws.slug,
        expiresAt: later(TRANSFER_TTL_MS),
      });
      expect(
        (await pendingTransfersFor(sql, recipient.email.toUpperCase(), NOW)).map((t) => t.id),
      ).toEqual([offer.id]);
      // Nothing moves until the recipient says so.
      expect((await pendingTransferOf(sql, ws.id, NOW))?.id).toBe(offer.id);
      expect(await roleOf(recipient.id, ws.id)).toBe('member');

      const outcome = await acceptTransfer(
        sql,
        { transferId: offer.id, user: recipient, confirmedBy: 'password', now: later(60_000) },
        hosted,
      );
      expect(outcome.transfer.status).toBe('accepted');
      expect(outcome.accountId).not.toBe(ws.accountId);
      expect(outcome.billingAdminsChanged).toBe(1);

      const [moved] =
        await sql`select slug, account_id, plan from app_workspaces where id = ${ws.id}`;
      expect(moved).toEqual({ slug: ws.slug, account_id: outcome.accountId, plan: 'free' });
      const [account] =
        await sql`select owner_user_id from app_accounts where id = ${outcome.accountId}`;
      expect(account?.owner_user_id).toBe(recipient.id);

      expect(await roleOf(recipient.id, ws.id)).toBe('owner');
      expect(await roleOf(ws.owner.id, ws.id)).toBe('admin');
      expect(await roleOf(billingAdmin.id, ws.id)).toBe('member');
      const [keys] =
        await sql`select count(*)::int as n from app_api_keys where workspace_id = ${ws.id}`;
      expect(keys?.n).toBe(1);
      const [credits] = await sql`select account_id, available from app_esign_credits`;
      expect(credits).toEqual({ account_id: ws.accountId, available: 40 });

      expect(await pendingTransferOf(sql, ws.id, later(120_000))).toBeNull();
      const history = await transferHistory(sql, ws.id, later(120_000));
      expect(history.map((h) => h.action)).toEqual([
        'workspace.transfer_accepted',
        'workspace.transfer_started',
      ]);
      expect(history[0]).toMatchObject({
        actorName: 'Ravi',
        data: {
          fromAccountId: ws.accountId,
          toAccountId: outcome.accountId,
          confirmedBy: 'password',
          previousOwner: 'admin',
          billingAdminsChanged: 1,
        },
      });
      expect(history[1]).toMatchObject({ actorName: 'Owner', data: { toEmail: recipient.email } });

      // The offer is used up.
      const again = await failure(
        acceptTransfer(
          sql,
          { transferId: offer.id, user: recipient, confirmedBy: 'password', now: later(180_000) },
          hosted,
        ),
      );
      expect(again).toMatchObject({ code: 'CONFLICT' });
      expect(again.message).toContain('was accepted');
    });

    it('lets the previous owner leave instead of staying as an admin', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'admin', 'Ravi');
      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: false,
          now: NOW,
        },
        hosted,
      );
      await acceptTransfer(
        sql,
        { transferId: offer.id, user: recipient, confirmedBy: 'recent-sign-in', now: NOW },
        hosted,
      );
      expect(await roleOf(ws.owner.id, ws.id)).toBeNull();
      expect(await roleOf(recipient.id, ws.id)).toBe('owner');
    });

    it('takes someone who was only invited, and uses up their invitation', async () => {
      const ws = await workspace('cloud');
      const email = `invitee-${randomUUID().slice(0, 6)}@example.com`;
      await createInvitation(sql, {
        workspaceId: ws.id,
        email,
        role: 'billing',
        invitedBy: ws.actor,
        now: NOW,
      });
      const offer = await startTransfer(
        sql,
        { workspaceId: ws.id, actor: ws.actor, email, previousOwnerStays: true, now: NOW },
        hosted,
      );
      expect(offer.toUserId).toBeNull();
      const id = randomUUID();
      await sql`insert into auth_users (id, name, email) values (${id}, 'Invitee', ${email})`;
      await acceptTransfer(
        sql,
        { transferId: offer.id, user: { id, email }, confirmedBy: 'password', now: NOW },
        hosted,
      );
      expect(await roleOf(id, ws.id)).toBe('owner');
      const [invitation] =
        await sql`select accepted_at from app_invitations where lower(email) = ${email}`;
      expect(invitation?.accepted_at).not.toBeNull();
    });
  });

  describe('the recipient plan', () => {
    it('refuses a Free recipient who already holds a workspace, with the way to upgrade', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'member', 'Ravi');
      const own = await createWorkspace(sql, { name: 'Ravi Co', userId: recipient.id }, hosted);

      const early = await failure(
        startTransfer(
          sql,
          {
            workspaceId: ws.id,
            actor: ws.actor,
            email: recipient.email,
            previousOwnerStays: true,
            now: NOW,
          },
          hosted,
        ),
      );
      expect(early).toBeInstanceOf(PlanLimitError);
      expect(early).toMatchObject({
        code: 'PLAN_LIMIT',
        field: 'email',
        limit: 'ownedWorkspaces',
        used: 1,
        max: 1,
      });
      expect(early.message).toContain('Ravi is on the Free plan');
      expect(early.message).toContain('upgrade to Cloud');
      expect(await pendingTransferOf(sql, ws.id, NOW)).toBeNull();
      expect(await recipientRoomProblem(sql, recipient.id, hosted)).toEqual({
        message: expect.stringContaining('Your account is on the Free plan'),
        upgradePath: `/dashboard/${own.slug}/settings/plan`,
      });

      // Room when the offer is made, gone by the time it is accepted: checked again then.
      await sql.begin((tx) =>
        setAccountPlan(tx, own.accountId, { plan: 'cloud', source: 'operator' }),
      );
      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: NOW,
        },
        hosted,
      );
      await sql.begin((tx) =>
        setAccountPlan(tx, own.accountId, { plan: 'free', source: 'operator' }),
      );
      const late = await failure(
        acceptTransfer(
          sql,
          { transferId: offer.id, user: recipient, confirmedBy: 'password', now: NOW },
          hosted,
        ),
      );
      expect(late).toMatchObject({ code: 'PLAN_LIMIT', limit: 'ownedWorkspaces' });
      expect(late.message).toContain('Upgrade to Cloud');
      expect(late.message).toContain(`/dashboard/${own.slug}/settings/plan`);
      expect((await getTransfer(sql, offer.id, NOW))?.status).toBe('pending');
      const [still] = await sql`select account_id from app_workspaces where id = ${ws.id}`;
      expect(still?.account_id).toBe(ws.accountId);

      await sql.begin((tx) =>
        setAccountPlan(tx, own.accountId, { plan: 'cloud', source: 'billing' }),
      );
      expect(await recipientRoomProblem(sql, recipient.id, hosted)).toBeNull();
      const done = await acceptTransfer(
        sql,
        { transferId: offer.id, user: recipient, confirmedBy: 'password', now: NOW },
        hosted,
      );
      expect(done.accountId).toBe(own.accountId);
      const [moved] = await sql`select plan from app_workspaces where id = ${ws.id}`;
      expect(moved?.plan).toBe('cloud');
    });

    it('counts nothing on a self-hosted install', async () => {
      const ws = await workspace('cloud', selfHosted);
      const recipient = await join(ws.id, 'member', 'Ravi');
      await createWorkspace(
        sql,
        { name: 'Ravi Co', userId: recipient.id, plan: 'free' },
        selfHosted,
      );
      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: NOW,
        },
        selfHosted,
      );
      const done = await acceptTransfer(
        sql,
        { transferId: offer.id, user: recipient, confirmedBy: 'password', now: NOW },
        selfHosted,
      );
      expect(done.transfer.status).toBe('accepted');
    });
  });

  describe('expiry and cancelling', () => {
    it('expires an offer after 7 days and records it', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'member', 'Ravi');
      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: NOW,
        },
        hosted,
      );
      const justBefore = later(TRANSFER_TTL_MS - 1000);
      expect((await getTransfer(sql, offer.id, justBefore))?.status).toBe('pending');

      const after = later(TRANSFER_TTL_MS + 1000);
      const err = await failure(
        acceptTransfer(
          sql,
          { transferId: offer.id, user: recipient, confirmedBy: 'password', now: after },
          hosted,
        ),
      );
      expect(err).toMatchObject({ code: 'CONFLICT' });
      expect(err.message).toContain('expired on 30 November 2026');
      expect(err.message).toContain('Ask Owner to start the transfer again');
      expect((await getTransfer(sql, offer.id, after))?.status).toBe('expired');
      expect(await pendingTransfersFor(sql, recipient.email, after)).toEqual([]);
      expect((await transferHistory(sql, ws.id, after)).map((h) => h.action)).toEqual([
        'workspace.transfer_expired',
        'workspace.transfer_started',
      ]);
      const [still] = await sql`select account_id from app_workspaces where id = ${ws.id}`;
      expect(still?.account_id).toBe(ws.accountId);

      // A new offer can be made once the old one has run out.
      const next = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: after,
        },
        hosted,
      );
      expect(next.status).toBe('pending');
    });

    it('lets the owner cancel an open offer, after which it cannot be accepted', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'member', 'Ravi');
      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: NOW,
        },
        hosted,
      );
      const cancelled = await cancelTransfer(sql, {
        workspaceId: ws.id,
        actor: ws.actor,
        now: NOW,
      });
      expect(cancelled.status).toBe('cancelled');
      const err = await failure(
        acceptTransfer(
          sql,
          { transferId: offer.id, user: recipient, confirmedBy: 'password', now: NOW },
          hosted,
        ),
      );
      expect(err.message).toContain('was cancelled');
      expect(await roleOf(recipient.id, ws.id)).toBe('member');

      const none = await failure(
        cancelTransfer(sql, { workspaceId: ws.id, actor: ws.actor, now: NOW }),
      );
      expect(none).toMatchObject({ code: 'NOT_FOUND' });
      expect(none.message).toContain('refresh to see its history');
      expect((await transferHistory(sql, ws.id, NOW)).map((h) => h.action)).toEqual([
        'workspace.transfer_cancelled',
        'workspace.transfer_started',
      ]);
    });

    it('lets the recipient decline', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'member', 'Ravi');
      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: NOW,
        },
        hosted,
      );
      expect(
        (await declineTransfer(sql, { transferId: offer.id, user: recipient, now: NOW })).status,
      ).toBe('declined');
      expect(await pendingTransferOf(sql, ws.id, NOW)).toBeNull();
    });
  });

  describe('who may', () => {
    it('lets only the owner who holds the account start a transfer', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'member', 'Ravi');
      const start = (actor: { userId: string; role: Role }) =>
        startTransfer(
          sql,
          { workspaceId: ws.id, actor, email: recipient.email, previousOwnerStays: true, now: NOW },
          hosted,
        );
      for (const role of ['admin', 'billing', 'owner'] as const) {
        const someone = await join(ws.id, role);
        const err = await failure(start({ userId: someone.id, role }));
        expect(err).toMatchObject({ code: 'FORBIDDEN' });
        expect(err.message).toContain('Only the owner whose plan this workspace is on');
      }
      expect(await pendingTransferOf(sql, ws.id, NOW)).toBeNull();
      expect((await start(ws.actor)).status).toBe('pending');

      const twice = await failure(start(ws.actor));
      expect(twice).toMatchObject({ code: 'CONFLICT', field: 'email' });
      expect(twice.message).toContain('Cancel that transfer first');

      const admin = await join(ws.id, 'admin', 'Admin');
      expect(
        await failure(
          cancelTransfer(sql, {
            workspaceId: ws.id,
            actor: { userId: admin.id, role: 'admin' },
            now: NOW,
          }),
        ),
      ).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('offers only to someone in the workspace, and never to the owner', async () => {
      const ws = await workspace('cloud');
      const outsider = await person('Stranger');
      const offer = (email: string) =>
        startTransfer(
          sql,
          { workspaceId: ws.id, actor: ws.actor, email, previousOwnerStays: true, now: NOW },
          hosted,
        );
      const notIn = await failure(offer(outsider.email));
      expect(notIn).toMatchObject({ code: 'VALIDATION', field: 'email' });
      expect(notIn.message).toContain('Invite them from Settings, Team first');
      expect(await failure(offer(ws.owner.email))).toMatchObject({
        code: 'VALIDATION',
        field: 'email',
      });
      expect(await failure(offer('not an email'))).toMatchObject({
        code: 'VALIDATION',
        field: 'email',
      });
    });

    it('lets only the person it was offered to accept or decline it', async () => {
      const ws = await workspace('cloud');
      const recipient = await join(ws.id, 'member', 'Ravi');
      const other = await join(ws.id, 'admin', 'Other');
      const offer = await startTransfer(
        sql,
        {
          workspaceId: ws.id,
          actor: ws.actor,
          email: recipient.email,
          previousOwnerStays: true,
          now: NOW,
        },
        hosted,
      );
      const wrong = await failure(
        acceptTransfer(
          sql,
          { transferId: offer.id, user: other, confirmedBy: 'password', now: NOW },
          hosted,
        ),
      );
      expect(wrong).toMatchObject({ code: 'NOT_FOUND' });
      expect(wrong.message).toContain('Sign in with the email it was sent to');
      expect(
        await failure(declineTransfer(sql, { transferId: offer.id, user: ws.owner, now: NOW })),
      ).toMatchObject({
        code: 'NOT_FOUND',
      });

      // Someone removed from the workspace after the offer cannot take it.
      await sql`delete from app_members where workspace_id = ${ws.id} and user_id = ${recipient.id}`;
      const removed = await failure(
        acceptTransfer(
          sql,
          { transferId: offer.id, user: recipient, confirmedBy: 'password', now: NOW },
          hosted,
        ),
      );
      expect(removed).toMatchObject({ code: 'CONFLICT' });
      expect(removed.message).toContain('invite you again');
    });
  });
});
