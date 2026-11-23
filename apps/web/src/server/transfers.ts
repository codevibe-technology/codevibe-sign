import 'server-only';
import type postgres from 'postgres';
import { PLAN_NAMES, limitsFor, planPagePath, type Plan, type PlanSettings } from '@/lib/plans';
import type { Role } from '@/lib/roles';
import type { TransferStep } from '@/lib/transfers';
import { accountOfUser, lockAccountOfUser } from './accounts';
import { recordAudit } from './billing/audit';
import { randomId } from './crypto';
import { AppError } from './errors';
import { cleanEmail } from './invitations';
import { PlanLimitError, countAccountWorkspaces, planSettings, startingPlan } from './plans';
import { userLabel } from './profile';

type Sql = postgres.Sql | postgres.TransactionSql;

/** How long the person a workspace is offered to has to accept it. */
export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TransferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

/** How the person taking the workspace showed it was really them, just before they did. */
export type TransferConfirmation = 'password' | 'recent-sign-in';

export interface Transfer {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  fromAccountId: string | null;
  fromUserId: string | null;
  fromName: string | null;
  toEmail: string;
  toUserId: string | null;
  previousOwnerStays: boolean;
  status: TransferStatus;
  expiresAt: Date;
  createdAt: Date;
  decidedAt: Date | null;
}

interface TransferRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  from_account_id: string | null;
  from_user_id: string | null;
  from_name: string | null;
  to_email: string;
  to_user_id: string | null;
  previous_owner_stays: boolean;
  status: TransferStatus;
  expires_at: Date;
  created_at: Date;
  decided_at: Date | null;
}

const toTransfer = (row: TransferRow): Transfer => ({
  id: row.id,
  workspaceId: row.workspace_id,
  workspaceName: row.workspace_name,
  workspaceSlug: row.workspace_slug,
  fromAccountId: row.from_account_id,
  fromUserId: row.from_user_id,
  fromName: row.from_name,
  toEmail: row.to_email,
  toUserId: row.to_user_id,
  previousOwnerStays: row.previous_owner_stays,
  status: row.status,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
});

const SELECT = (sql: Sql) => sql`
  select t.id, t.workspace_id, w.name as workspace_name, w.slug as workspace_slug,
    t.from_account_id, t.from_user_id, ${userLabel(sql)} as from_name, t.to_email, t.to_user_id,
    t.previous_owner_stays, t.status, t.expires_at, t.created_at, t.decided_at
  from app_workspace_transfers t
  join app_workspaces w on w.id = t.workspace_id
  left join auth_users u on u.id = t.from_user_id`;

const day = (date: Date) =>
  date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Marks offers whose week has run out as expired, with an audit line each. Every read of a
 * transfer runs it first, so an old offer never looks open.
 */
export async function expireTransfers(
  sql: Sql,
  now: Date,
  scope: { workspaceId: string } | { transferId: string } | { email: string } | 'all' = 'all',
): Promise<number> {
  const where =
    scope === 'all'
      ? sql``
      : 'workspaceId' in scope
        ? sql`and workspace_id = ${scope.workspaceId}`
        : 'transferId' in scope
          ? sql`and id = ${scope.transferId}`
          : sql`and lower(to_email) = ${scope.email.trim().toLowerCase()}`;
  const expired = await sql<{ id: string; workspace_id: string; from_account_id: string | null }[]>`
    update app_workspace_transfers set status = 'expired', decided_at = expires_at
    where status = 'pending' and expires_at <= ${now} ${where}
    returning id, workspace_id, from_account_id`;
  for (const row of expired) {
    await recordAudit(sql, {
      workspaceId: row.workspace_id,
      accountId: row.from_account_id,
      action: 'workspace.transfer_expired',
      target: row.id,
    });
  }
  return expired.length;
}

export async function getTransfer(
  sql: Sql,
  id: string,
  now = new Date(),
): Promise<Transfer | null> {
  await expireTransfers(sql, now, { transferId: id });
  const [row] = await sql<TransferRow[]>`${SELECT(sql)} where t.id = ${id}`;
  return row ? toTransfer(row) : null;
}

/** The open offer of a workspace, if there is one. */
export async function pendingTransferOf(
  sql: Sql,
  workspaceId: string,
  now = new Date(),
): Promise<Transfer | null> {
  await expireTransfers(sql, now, { workspaceId });
  const [row] = await sql<TransferRow[]>`
    ${SELECT(sql)} where t.workspace_id = ${workspaceId} and t.status = 'pending'`;
  return row ? toTransfer(row) : null;
}

/** Open offers made to an email address, for the notice in the app. */
export async function pendingTransfersFor(
  sql: Sql,
  email: string,
  now = new Date(),
): Promise<Transfer[]> {
  await expireTransfers(sql, now, { email });
  const rows = await sql<TransferRow[]>`
    ${SELECT(sql)} where lower(t.to_email) = ${email.trim().toLowerCase()}
      and t.status = 'pending'
    order by t.created_at`;
  return rows.map(toTransfer);
}

/** Every step of every transfer of a workspace, newest first, from the audit log. */
export async function transferHistory(
  sql: Sql,
  workspaceId: string,
  now = new Date(),
): Promise<TransferStep[]> {
  await expireTransfers(sql, now, { workspaceId });
  const rows = await sql<(Omit<TransferStep, 'createdAt'> & { createdAt: Date })[]>`
    select l.id, l.action, ${userLabel(sql)} as "actorName", l.data, l.created_at as "createdAt"
    from app_audit_log l left join auth_users u on u.id = l.actor_id
    where l.workspace_id = ${workspaceId} and starts_with(l.action, 'workspace.transfer_')
    order by l.created_at desc, l.id desc
    limit 50`;
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/**
 * Refuses an account that has no room for one more workspace. `audience` decides who the
 * message speaks to: the owner offering the workspace, or the person taking it.
 */
function assertRoomForWorkspace(
  input: { plan: Plan; extraSeats: number; held: number; settings: PlanSettings },
  audience: { kind: 'owner'; recipient: string } | { kind: 'recipient'; upgradePath: string },
): void {
  if (input.settings.mode === 'self-hosted') return;
  const max = limitsFor(input.plan, input.settings, input.extraSeats).ownedWorkspaces;
  if (max === null || input.held + 1 <= max) return;
  const name = PLAN_NAMES[input.plan];
  const holds = `${max} ${max === 1 ? 'workspace' : 'workspaces'}`;
  throw new PlanLimitError({
    limit: 'ownedWorkspaces',
    used: input.held,
    max,
    plan: input.plan,
    field: audience.kind === 'owner' ? 'email' : undefined,
    message:
      audience.kind === 'owner'
        ? `${audience.recipient} is on the ${name} plan, which holds ${holds}, and already has ${input.held}. Ask them to upgrade to Cloud on their Plan and usage page, then start the transfer again.`
        : `Your account is on the ${name} plan, which holds ${holds}, and you already have ${input.held}. Upgrade to Cloud on your Plan and usage page (${audience.upgradePath}), then accept again. This offer stays open until it expires.`,
  });
}

/** The account a person holds and how many workspaces it has; a person with none has room for one. */
async function roomOf(sql: Sql, userId: string | null, settings: PlanSettings) {
  const account = userId ? await accountOfUser(sql, userId) : null;
  return {
    plan: account?.plan ?? startingPlan(settings),
    extraSeats: account?.extraSeats ?? 0,
    held: account ? await countAccountWorkspaces(sql, account.id) : 0,
  };
}

async function recipientUpgradePath(sql: Sql, userId: string): Promise<string> {
  const [row] = await sql<{ slug: string }[]>`
    select w.slug from app_workspaces w join app_accounts a on a.id = w.account_id
    where a.owner_user_id = ${userId} order by w.created_at, w.id limit 1`;
  return row ? planPagePath(row.slug) : '/#pricing';
}

/**
 * Why the person cannot take one more workspace on their plan right now, with where to
 * upgrade; null when they can. For the offer page, before they confirm.
 */
export async function recipientRoomProblem(
  sql: Sql,
  userId: string,
  settings: PlanSettings = planSettings(),
): Promise<{ message: string; upgradePath: string } | null> {
  const upgradePath = await recipientUpgradePath(sql, userId);
  try {
    assertRoomForWorkspace(
      { ...(await roomOf(sql, userId, settings)), settings },
      { kind: 'recipient', upgradePath },
    );
    return null;
  } catch (err) {
    if (err instanceof PlanLimitError) return { message: err.message, upgradePath };
    throw err;
  }
}

/**
 * Offers a workspace to someone already in it, or invited to it, so it moves to their account.
 * Only the person whose account holds the workspace may offer it. The recipient's plan is
 * checked now, to say so early, and again when they accept.
 */
export async function startTransfer(
  sql: postgres.Sql,
  input: {
    workspaceId: string;
    actor: { userId: string; role: Role };
    email: string;
    previousOwnerStays: boolean;
    now?: Date;
    ip?: string | null;
  },
  settings: PlanSettings = planSettings(),
): Promise<Transfer> {
  const now = input.now ?? new Date();
  const email = cleanEmail(input.email);
  const id = randomId('wtr');
  await sql.begin(async (tx) => {
    const [workspace] = await tx<{ account_id: string; owner_user_id: string | null }[]>`
      select w.account_id, a.owner_user_id
      from app_workspaces w join app_accounts a on a.id = w.account_id
      where w.id = ${input.workspaceId}
      for update of w`;
    if (!workspace) throw new AppError('NOT_FOUND', 'Workspace not found');
    if (input.actor.role !== 'owner' || workspace.owner_user_id !== input.actor.userId) {
      throw new AppError(
        'FORBIDDEN',
        'Only the owner whose plan this workspace is on can transfer it. Ask them to start the transfer from Settings, Workspace.',
      );
    }
    await expireTransfers(tx, now, { workspaceId: input.workspaceId });
    const [open] = await tx<{ to_email: string }[]>`
      select to_email from app_workspace_transfers
      where workspace_id = ${input.workspaceId} and status = 'pending'`;
    if (open) {
      throw new AppError(
        'CONFLICT',
        `This workspace is already offered to ${open.to_email}. Cancel that transfer first to offer it to someone else.`,
        'email',
      );
    }
    const [recipient] = await tx<{ id: string; name: string; member: boolean }[]>`
      select u.id, ${userLabel(tx)} as name,
        exists (select 1 from app_members m
          where m.workspace_id = ${input.workspaceId} and m.user_id = u.id) as member
      from auth_users u where lower(u.email) = ${email}`;
    if (recipient?.id === input.actor.userId) {
      throw new AppError(
        'VALIDATION',
        'This workspace is already yours. Enter the email of the person who should take it over.',
        'email',
      );
    }
    const [invited] = await tx`
      select 1 from app_invitations
      where workspace_id = ${input.workspaceId} and lower(email) = ${email}
        and accepted_at is null and revoked_at is null and expires_at > ${now}`;
    if (!recipient?.member && !invited) {
      throw new AppError(
        'VALIDATION',
        `${email} is not in this workspace. Invite them from Settings, Team first, then start the transfer.`,
        'email',
      );
    }
    assertRoomForWorkspace(
      { ...(await roomOf(tx, recipient?.id ?? null, settings)), settings },
      { kind: 'owner', recipient: recipient?.name ?? email },
    );
    await tx`
      insert into app_workspace_transfers
        (id, workspace_id, from_account_id, from_user_id, to_email, to_user_id,
          previous_owner_stays, expires_at, created_at)
      values (
        ${id}, ${input.workspaceId}, ${workspace.account_id}, ${input.actor.userId}, ${email},
        ${recipient?.id ?? null}, ${input.previousOwnerStays},
        ${new Date(now.getTime() + TRANSFER_TTL_MS)}, ${now}
      )`;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      accountId: workspace.account_id,
      actorId: input.actor.userId,
      action: 'workspace.transfer_started',
      target: id,
      data: { toEmail: email, previousOwnerStays: input.previousOwnerStays },
      ip: input.ip ?? null,
    });
  });
  return (await getTransfer(sql, id, now))!;
}

/** Withdraws the open offer of a workspace. The owner who made it, or any owner of it, may. */
export async function cancelTransfer(
  sql: postgres.Sql,
  input: { workspaceId: string; actor: { userId: string; role: Role }; now?: Date },
): Promise<Transfer> {
  const now = input.now ?? new Date();
  if (input.actor.role !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only an owner of this workspace can cancel its transfer.');
  }
  const id = await sql.begin(async (tx) => {
    await expireTransfers(tx, now, { workspaceId: input.workspaceId });
    const [row] = await tx<{ id: string; from_account_id: string | null; to_email: string }[]>`
      update app_workspace_transfers
      set status = 'cancelled', decided_at = ${now}, decided_by = ${input.actor.userId}
      where workspace_id = ${input.workspaceId} and status = 'pending'
      returning id, from_account_id, to_email`;
    if (!row) {
      throw new AppError(
        'NOT_FOUND',
        'There is no open transfer to cancel. It may have been accepted, declined or expired; refresh to see its history.',
      );
    }
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      accountId: row.from_account_id,
      actorId: input.actor.userId,
      action: 'workspace.transfer_cancelled',
      target: row.id,
      data: { toEmail: row.to_email },
    });
    return row.id;
  });
  return (await getTransfer(sql, id, now))!;
}

/** Loads an open offer for the person it was made to, under a row lock. */
async function lockOffer(
  tx: postgres.TransactionSql,
  transferId: string,
  user: { email: string },
  now: Date,
): Promise<TransferRow> {
  await expireTransfers(tx, now, { transferId });
  const [row] = await tx<TransferRow[]>`
    ${SELECT(tx)} where t.id = ${transferId} for update of t`;
  if (!row || row.to_email !== user.email.trim().toLowerCase()) {
    throw new AppError(
      'NOT_FOUND',
      'This transfer is not for the address you are signed in with. Sign in with the email it was sent to.',
    );
  }
  if (row.status === 'expired') {
    throw new AppError(
      'CONFLICT',
      `This offer expired on ${day(row.expires_at)}. Ask ${row.from_name ?? 'the owner'} to start the transfer again.`,
    );
  }
  if (row.status !== 'pending') {
    throw new AppError(
      'CONFLICT',
      `This offer was ${row.status} and can no longer be used. Ask ${row.from_name ?? 'the owner'} to start a new transfer if you still need it.`,
    );
  }
  return row;
}

export async function declineTransfer(
  sql: postgres.Sql,
  input: { transferId: string; user: { id: string; email: string }; now?: Date },
): Promise<Transfer> {
  const now = input.now ?? new Date();
  await sql.begin(async (tx) => {
    const row = await lockOffer(tx, input.transferId, input.user, now);
    await tx`update app_workspace_transfers
      set status = 'declined', decided_at = ${now}, decided_by = ${input.user.id}
      where id = ${row.id}`;
    await recordAudit(tx, {
      workspaceId: row.workspace_id,
      accountId: row.from_account_id,
      actorId: input.user.id,
      action: 'workspace.transfer_declined',
      target: row.id,
    });
  });
  return (await getTransfer(sql, input.transferId, now))!;
}

export interface TransferOutcome {
  transfer: Transfer;
  /** The account that now holds the workspace. */
  accountId: string;
  /** Billing admins of the workspace who became members: they paid for the old account. */
  billingAdminsChanged: number;
}

/**
 * Moves the workspace to the account of the person it was offered to. Its documents,
 * templates, members, API keys and webhooks go with it; the plan, eSign credits,
 * subscription and invoices stay with the account that paid for them. The recipient becomes
 * an owner, and the previous owner an admin unless they chose to leave. Billing admins become
 * members, because what they were trusted with was the previous account's money.
 */
export async function acceptTransfer(
  sql: postgres.Sql,
  input: {
    transferId: string;
    user: { id: string; email: string };
    confirmedBy: TransferConfirmation;
    now?: Date;
    ip?: string | null;
  },
  settings: PlanSettings = planSettings(),
): Promise<TransferOutcome> {
  const now = input.now ?? new Date();
  const outcome = await sql.begin(async (tx) => {
    const row = await lockOffer(tx, input.transferId, input.user, now);
    const [workspace] = await tx<{ account_id: string }[]>`
      select account_id from app_workspaces where id = ${row.workspace_id} for update`;
    if (!workspace || workspace.account_id !== row.from_account_id) {
      throw new AppError(
        'CONFLICT',
        'This workspace has changed hands since the offer was made. Ask its owner to start a new transfer.',
      );
    }
    const [membership] = await tx<{ role: Role }[]>`
      select role from app_members
      where workspace_id = ${row.workspace_id} and user_id = ${input.user.id}`;
    const [invitation] = membership
      ? []
      : await tx<{ id: string }[]>`
          select id from app_invitations
          where workspace_id = ${row.workspace_id} and lower(email) = ${row.to_email}
            and accepted_at is null and revoked_at is null and expires_at > ${now}
          for update`;
    if (!membership && !invitation) {
      throw new AppError(
        'CONFLICT',
        `You are no longer in ${row.workspace_name}, so it cannot move to you. Ask ${row.from_name ?? 'the owner'} to invite you again and start a new transfer.`,
      );
    }

    const before = await accountOfUser(tx, input.user.id);
    const room = await roomOf(tx, input.user.id, settings);
    assertRoomForWorkspace(
      { ...room, settings },
      { kind: 'recipient', upgradePath: await recipientUpgradePath(tx, input.user.id) },
    );
    const account = await lockAccountOfUser(
      tx,
      input.user.id,
      before?.plan ?? startingPlan(settings),
    );

    await tx`update app_workspaces
      set account_id = ${account.id}, plan = ${account.plan}, updated_at = now()
      where id = ${row.workspace_id}`;
    if (membership) {
      await tx`update app_members set role = 'owner'
        where workspace_id = ${row.workspace_id} and user_id = ${input.user.id}`;
    } else {
      await tx`update app_invitations set accepted_at = ${now} where id = ${invitation!.id}`;
      await tx`insert into app_members (workspace_id, user_id, role)
        values (${row.workspace_id}, ${input.user.id}, 'owner')`;
    }
    if (row.from_user_id && row.from_user_id !== input.user.id) {
      if (row.previous_owner_stays) {
        await tx`update app_members set role = 'admin'
          where workspace_id = ${row.workspace_id} and user_id = ${row.from_user_id}`;
      } else {
        await tx`delete from app_members
          where workspace_id = ${row.workspace_id} and user_id = ${row.from_user_id}`;
      }
    }
    const demoted = await tx`update app_members set role = 'member'
      where workspace_id = ${row.workspace_id} and role = 'billing'
      returning user_id`;
    await tx`update app_invitations set role = 'member'
      where workspace_id = ${row.workspace_id} and role = 'billing'
        and accepted_at is null and revoked_at is null`;

    await tx`update app_workspace_transfers
      set status = 'accepted', decided_at = ${now}, decided_by = ${input.user.id},
        to_user_id = ${input.user.id}, to_account_id = ${account.id}
      where id = ${row.id}`;
    await recordAudit(tx, {
      workspaceId: row.workspace_id,
      accountId: account.id,
      actorId: input.user.id,
      action: 'workspace.transfer_accepted',
      target: row.id,
      data: {
        fromAccountId: row.from_account_id,
        toAccountId: account.id,
        confirmedBy: input.confirmedBy,
        previousOwner: row.previous_owner_stays ? 'admin' : 'left',
        billingAdminsChanged: demoted.length,
      },
      ip: input.ip ?? null,
    });
    return { accountId: account.id, billingAdminsChanged: demoted.length };
  });
  return { ...outcome, transfer: (await getTransfer(sql, input.transferId, now))! };
}
