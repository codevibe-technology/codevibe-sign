import 'server-only';
import type postgres from 'postgres';
import { z } from 'zod';
import { canManageRole, type Role } from '@/lib/roles';
import { randomId, randomSecret, sha256Hex } from './crypto';
import { AppError } from './errors';
import { assertRoom, countSeats, lockedPlan } from './plans';
import { cleanPersonName, userLabel } from './profile';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  /** What the inviter called the person, if anything: a suggestion for their own name. */
  name: string | null;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

export interface InvitationDetails extends Invitation {
  workspaceName: string;
  workspaceSlug: string;
  invitedByName: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

const emailSchema = z.email();

export function cleanEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  if (!emailSchema.safeParse(clean).success) {
    throw new AppError('VALIDATION', 'Enter a valid email address', 'email');
  }
  return clean;
}

/**
 * Invites `email` to a workspace and returns the one-time token for the link. Only its hash is
 * stored. Inviting the same address again replaces the open invitation.
 */
export async function createInvitation(
  sql: postgres.Sql,
  input: {
    workspaceId: string;
    email: string;
    name?: string | null;
    role: Role;
    invitedBy: { userId: string; role: Role };
    now?: Date;
  },
): Promise<{ invitation: Invitation; token: string }> {
  const email = cleanEmail(input.email);
  const name = input.name?.trim() ? cleanPersonName(input.name) : null;
  if (!canManageRole(input.invitedBy.role, input.role)) {
    throw new AppError('FORBIDDEN', 'Only an owner can invite another owner', 'role');
  }
  const now = input.now ?? new Date();
  const token = randomSecret();
  const invitation: Invitation = {
    id: randomId('inv'),
    workspaceId: input.workspaceId,
    email,
    name,
    role: input.role,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    createdAt: now,
  };
  await sql.begin(async (tx) => {
    const plan = await lockedPlan(tx, input.workspaceId);
    const [member] = await tx`
      select 1 from app_members m join auth_users u on u.id = m.user_id
      where m.workspace_id = ${input.workspaceId} and lower(u.email) = ${email}`;
    if (member) throw new AppError('CONFLICT', `${email} is already in this workspace`, 'email');
    await tx`update app_invitations set revoked_at = ${now}
      where workspace_id = ${input.workspaceId} and lower(email) = ${email}
        and accepted_at is null and revoked_at is null`;
    if (plan) {
      const seats = await countSeats(tx, input.workspaceId, now);
      assertRoom(plan, 'members', seats.members + seats.invited, 1, 'email');
    }
    await tx`insert into app_invitations
        (id, workspace_id, email, name, role, token_hash, invited_by, expires_at, created_at)
      values (${invitation.id}, ${input.workspaceId}, ${email}, ${name}, ${input.role},
        ${sha256Hex(token)}, ${input.invitedBy.userId}, ${invitation.expiresAt}, ${now})`;
  });
  return { invitation, token };
}

export async function listOpenInvitations(
  sql: postgres.Sql,
  workspaceId: string,
  now = new Date(),
): Promise<Invitation[]> {
  return sql<Invitation[]>`
    select id, workspace_id as "workspaceId", email, name, role, expires_at as "expiresAt",
      created_at as "createdAt"
    from app_invitations
    where workspace_id = ${workspaceId} and accepted_at is null and revoked_at is null
      and expires_at > ${now}
    order by created_at desc`;
}

export async function revokeInvitation(
  sql: postgres.Sql,
  workspaceId: string,
  invitationId: string,
) {
  const rows = await sql`update app_invitations set revoked_at = now()
    where id = ${invitationId} and workspace_id = ${workspaceId}
      and accepted_at is null and revoked_at is null
    returning id`;
  if (rows.length === 0) throw new AppError('NOT_FOUND', 'That invitation is no longer open');
}

export async function findInvitation(
  sql: postgres.Sql,
  token: string,
): Promise<InvitationDetails | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await sql<InvitationDetails[]>`
    select i.id, i.workspace_id as "workspaceId", i.email, i.name, i.role,
      i.expires_at as "expiresAt",
      i.created_at as "createdAt", i.accepted_at as "acceptedAt", i.revoked_at as "revokedAt",
      w.name as "workspaceName", w.slug as "workspaceSlug",
      ${userLabel(sql)} as "invitedByName"
    from app_invitations i
    join app_workspaces w on w.id = i.workspace_id
    left join auth_users u on u.id = i.invited_by
    where i.token_hash = ${sha256Hex(token)}`;
  return row ?? null;
}

export type InvitationState = 'open' | 'expired' | 'revoked' | 'accepted';

export function invitationState(invitation: InvitationDetails, now = new Date()): InvitationState {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'open';
}

/**
 * Adds the signed-in user to the invitation's workspace. The invitation must be open and
 * addressed to the user's own email, and it can be used once.
 */
export async function acceptInvitation(
  sql: postgres.Sql,
  token: string,
  user: { id: string; email: string },
  now = new Date(),
): Promise<{ workspaceSlug: string }> {
  const invitation = await findInvitation(sql, token);
  if (!invitation || invitationState(invitation, now) !== 'open') {
    throw new AppError('NOT_FOUND', 'This invitation is no longer valid. Ask for a new one');
  }
  if (invitation.email !== user.email.trim().toLowerCase()) {
    throw new AppError(
      'FORBIDDEN',
      `This invitation is for ${invitation.email}. Sign in with that address to accept it`,
    );
  }
  await sql.begin(async (tx) => {
    const used = await tx`update app_invitations set accepted_at = ${now}
      where id = ${invitation.id} and accepted_at is null and revoked_at is null
      returning id`;
    if (used.length === 0) {
      throw new AppError('NOT_FOUND', 'This invitation is no longer valid. Ask for a new one');
    }
    const plan = await lockedPlan(tx, invitation.workspaceId);
    if (plan) {
      const [count] = await tx<{ members: number; joined: boolean }[]>`
        select count(*)::int as members, bool_or(user_id = ${user.id}) as joined
        from app_members where workspace_id = ${invitation.workspaceId}`;
      if (!count?.joined) assertRoom(plan, 'members', count?.members ?? 0);
    }
    await tx`insert into app_members (workspace_id, user_id, role)
      values (${invitation.workspaceId}, ${user.id}, ${invitation.role})
      on conflict (workspace_id, user_id) do nothing`;
  });
  return { workspaceSlug: invitation.workspaceSlug };
}
