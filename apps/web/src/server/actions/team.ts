'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ROLES } from '@/lib/roles';
import { db } from '../db';
import { env } from '../env';
import { acceptInvitation, createInvitation, revokeInvitation } from '../invitations';
import { sendInvitation } from '../mail';
import { changeRole, removeMember } from '../members';
import { appRuntime } from '../runtime';
import { userAction, workspaceAction } from './action';

const role = z.enum(ROLES, { error: 'Pick a role' });
const id = z.string().min(1).max(64);
const refresh = (slug: string) => revalidatePath(`/w/${slug}/settings/team`);

export const inviteMemberAction = workspaceAction(
  'team.manage',
  z.object({ email: z.string({ error: 'Enter an email address' }), role }),
  async (ctx, input) => {
    const sql = db();
    const { invitation, token } = await createInvitation(sql, {
      workspaceId: ctx.workspace.id,
      email: input.email,
      role: input.role,
      invitedBy: { userId: ctx.user.id, role: ctx.role },
    });
    await sendInvitation(appRuntime().mailer, {
      to: invitation.email,
      url: `${env().APP_URL}/invite/${token}`,
      workspaceId: ctx.workspace.id,
      workspaceName: ctx.workspace.name,
      inviterName: ctx.user.name || ctx.user.email,
      role: invitation.role,
    });
    refresh(ctx.workspace.slug);
    return { email: invitation.email };
  },
);

export const revokeInvitationAction = workspaceAction(
  'team.manage',
  z.object({ invitationId: id }),
  async (ctx, input) => {
    await revokeInvitation(db(), ctx.workspace.id, input.invitationId);
    refresh(ctx.workspace.slug);
  },
);

export const changeRoleAction = workspaceAction(
  'team.manage',
  z.object({ userId: id, role }),
  async (ctx, input) => {
    await changeRole(db(), {
      workspaceId: ctx.workspace.id,
      actor: { userId: ctx.user.id, role: ctx.role },
      userId: input.userId,
      role: input.role,
    });
    refresh(ctx.workspace.slug);
  },
);

export const removeMemberAction = workspaceAction(
  'team.manage',
  z.object({ userId: id }),
  async (ctx, input) => {
    await removeMember(db(), {
      workspaceId: ctx.workspace.id,
      actor: { userId: ctx.user.id, role: ctx.role },
      userId: input.userId,
    });
    refresh(ctx.workspace.slug);
  },
);

export const leaveWorkspaceAction = workspaceAction('envelopes.read', z.object({}), async (ctx) => {
  await removeMember(db(), {
    workspaceId: ctx.workspace.id,
    actor: { userId: ctx.user.id, role: ctx.role },
    userId: ctx.user.id,
  });
});

export const acceptInvitationAction = userAction(
  z.object({ token: z.string().min(1).max(100) }),
  async (user, input) => acceptInvitation(db(), input.token, user),
);
