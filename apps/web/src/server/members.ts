import 'server-only';
import type postgres from 'postgres';
import { canManageRole, type Role } from '@/lib/roles';
import { AppError } from './errors';
import { userLabel } from './profile';
import { assertCanOwn } from './workspaces';

export interface Member {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  joinedAt: Date;
}

export async function listMembers(sql: postgres.Sql, workspaceId: string): Promise<Member[]> {
  return sql<Member[]>`
    select u.id as "userId", btrim(u.name) as name, u.email, u.image, m.role, m.created_at as "joinedAt"
    from app_members m join auth_users u on u.id = m.user_id
    where m.workspace_id = ${workspaceId}
    order by array_position(array['owner','admin','member','viewer'], m.role),
      lower(${userLabel(sql)})`;
}

interface Change {
  workspaceId: string;
  actor: { userId: string; role: Role };
  userId: string;
}

/**
 * Loads the target's membership under a row lock and checks the actor may change it. The lock on
 * every owner row keeps two requests from removing the last two owners at the same time.
 */
async function lockTarget(tx: postgres.TransactionSql, change: Change) {
  const owners = await tx<{ user_id: string }[]>`
    select user_id from app_members
    where workspace_id = ${change.workspaceId} and role = 'owner'
    for update`;
  const [target] = await tx<{ role: Role }[]>`
    select role from app_members
    where workspace_id = ${change.workspaceId} and user_id = ${change.userId}
    for update`;
  if (!target) throw new AppError('NOT_FOUND', 'That person is not in this workspace');
  if (!canManageRole(change.actor.role, target.role)) {
    throw new AppError('FORBIDDEN', 'Only an owner can change another owner');
  }
  const lastOwner = target.role === 'owner' && owners.length === 1;
  return { target, lastOwner };
}

export async function changeRole(sql: postgres.Sql, change: Change & { role: Role }) {
  if (!canManageRole(change.actor.role, change.role)) {
    throw new AppError('FORBIDDEN', 'Only an owner can make someone an owner', 'role');
  }
  await sql.begin(async (tx) => {
    const { target, lastOwner } = await lockTarget(tx, change);
    if (target.role === change.role) return;
    if (lastOwner) {
      throw new AppError('CONFLICT', 'Make someone else an owner first', 'role');
    }
    if (change.role === 'owner') {
      await assertCanOwn(tx, {
        userId: change.userId,
        workspaceId: change.workspaceId,
        field: 'role',
      });
    }
    await tx`update app_members set role = ${change.role}
      where workspace_id = ${change.workspaceId} and user_id = ${change.userId}`;
  });
}

/** Removes a member. Anyone may leave; the last owner may not. */
export async function removeMember(sql: postgres.Sql, change: Change) {
  await sql.begin(async (tx) => {
    const leaving = change.actor.userId === change.userId;
    const { lastOwner } = await lockTarget(
      tx,
      leaving ? { ...change, actor: { ...change.actor, role: 'owner' } } : change,
    );
    if (lastOwner) {
      throw new AppError(
        'CONFLICT',
        'A workspace needs an owner. Make someone else an owner first',
      );
    }
    await tx`delete from app_members
      where workspace_id = ${change.workspaceId} and user_id = ${change.userId}`;
  });
}
