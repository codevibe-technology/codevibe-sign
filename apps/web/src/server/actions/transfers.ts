'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { displayName } from '@/lib/person-name';
import { auth, lockout } from '../auth/auth';
import { hasPassword } from '../auth/passwords';
import { sessionStartedAt } from '../auth/session';
import { confirmIdentity } from '../auth/step-up';
import { clientAddress } from '../client-address';
import { db } from '../db';
import { env } from '../env';
import { sendTransferMail, type TransferMailKind } from '../mail';
import { appRuntime } from '../runtime';
import {
  acceptTransfer,
  cancelTransfer,
  declineTransfer,
  startTransfer,
  type Transfer,
} from '../transfers';
import { userAction, workspaceAction } from './action';

const day = (date: Date) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** Sends one transfer email; a failure is logged, never turned into a failed transfer. */
async function notify(
  kind: TransferMailKind,
  transfer: Transfer,
  to: string,
  extra: { ownerName?: string; recipient?: string } = {},
) {
  const base = env().APP_URL;
  const url =
    kind === 'offered'
      ? `${base}/transfer/${transfer.id}`
      : kind === 'accepted_recipient'
        ? `${base}/dashboard/${transfer.workspaceSlug}`
        : kind === 'started' || kind === 'declined'
          ? `${base}/dashboard/${transfer.workspaceSlug}/settings/workspace`
          : `${base}/dashboard`;
  await sendTransferMail(appRuntime().mailer, kind, {
    to,
    url,
    workspaceId: transfer.workspaceId,
    workspaceName: transfer.workspaceName,
    ownerName: extra.ownerName ?? transfer.fromName ?? 'The owner',
    recipient: extra.recipient ?? transfer.toEmail,
    expiresOn: day(transfer.expiresAt),
    previousOwnerStays: transfer.previousOwnerStays,
  }).catch((err: unknown) =>
    console.error('[transfer mail] failed', err instanceof Error ? err.message : err),
  );
}

const refresh = (slug: string) => revalidatePath(`/dashboard/${slug}`, 'layout');

export const startTransferAction = workspaceAction(
  'owners.manage',
  z.object({
    email: z.string({ error: 'Enter the email of the person who should take over' }).max(320),
    leave: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  }),
  async (ctx, input) => {
    const transfer = await startTransfer(db(), {
      workspaceId: ctx.workspace.id,
      actor: { userId: ctx.user.id, role: ctx.role },
      email: input.email,
      previousOwnerStays: !(input.leave === true || input.leave === 'true'),
      ip: clientAddress(await headers()),
    });
    const ownerName = displayName(ctx.user);
    await notify('offered', transfer, transfer.toEmail, { ownerName });
    await notify('started', transfer, ctx.user.email, { ownerName });
    refresh(ctx.workspace.slug);
    return { toEmail: transfer.toEmail, expiresAt: transfer.expiresAt.toISOString() };
  },
);

export const cancelTransferAction = workspaceAction('owners.manage', z.object({}), async (ctx) => {
  const transfer = await cancelTransfer(db(), {
    workspaceId: ctx.workspace.id,
    actor: { userId: ctx.user.id, role: ctx.role },
  });
  await notify('cancelled', transfer, transfer.toEmail, { ownerName: displayName(ctx.user) });
  refresh(ctx.workspace.slug);
});

const transferId = z.string().min(1).max(64);

/**
 * Takes over the workspace. The person confirms it is them first: their password, or a
 * sign-in from the last few minutes when they have no password.
 */
export const acceptTransferAction = userAction(
  z.object({ transferId, password: z.string().max(1000).optional() }),
  async (user, input) => {
    const sql = db();
    const confirmedBy = await confirmIdentity(
      {
        hasPassword: (id) => hasPassword(sql, id),
        verifyPassword: async (id, password) => {
          const [row] = await sql<{ password: string }[]>`
            select password from auth_accounts
            where user_id = ${id} and provider_id = 'credential' and password is not null`;
          if (!row) return false;
          const { password: hasher } = await auth().$context;
          return hasher.verify({ hash: row.password, password });
        },
        lockout: lockout(),
      },
      user,
      { password: input.password, sessionStartedAt: await sessionStartedAt() },
    );
    const { transfer } = await acceptTransfer(sql, {
      transferId: input.transferId,
      user,
      confirmedBy,
      ip: clientAddress(await headers()),
    });
    const recipient = displayName(user);
    const [owner] = transfer.fromUserId
      ? await sql<
          { email: string }[]
        >`select email from auth_users where id = ${transfer.fromUserId}`
      : [];
    if (owner) await notify('accepted_owner', transfer, owner.email, { recipient });
    await notify('accepted_recipient', transfer, user.email, { recipient });
    refresh(transfer.workspaceSlug);
    return { slug: transfer.workspaceSlug };
  },
);

export const declineTransferAction = userAction(z.object({ transferId }), async (user, input) => {
  const sql = db();
  const transfer = await declineTransfer(sql, { transferId: input.transferId, user });
  const [owner] = transfer.fromUserId
    ? await sql<{ email: string }[]>`select email from auth_users where id = ${transfer.fromUserId}`
    : [];
  if (owner) await notify('declined', transfer, owner.email, { recipient: displayName(user) });
  refresh(transfer.workspaceSlug);
});
