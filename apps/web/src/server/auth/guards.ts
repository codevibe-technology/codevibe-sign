import 'server-only';
import { notFound } from 'next/navigation';
import { can, type Permission } from '@/lib/roles';
import { db } from '../db';
import { findMembership, type Membership } from '../workspaces';
import { getSessionUser, requireUser, type SessionUser } from './session';

export interface WorkspaceAccess extends Membership {
  user: SessionUser;
}

/**
 * For pages under `/w/[slug]`: the signed-in member and their role. Anyone else gets a 404, so
 * a workspace's existence is not revealed to people outside it.
 */
export async function requireWorkspace(
  slug: string,
  permission: Permission = 'envelopes.read',
): Promise<WorkspaceAccess> {
  const user = await requireUser(`/w/${slug}`);
  const membership = await findMembership(db(), user.id, { slug });
  if (!membership || !can(membership.role, permission)) notFound();
  return { ...membership, user };
}

/** For route handlers: the member and role, or null (answer 404) for anyone else. */
export async function findWorkspaceAccess(slug: string): Promise<WorkspaceAccess | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const membership = await findMembership(db(), user.id, { slug });
  return membership ? { ...membership, user } : null;
}
