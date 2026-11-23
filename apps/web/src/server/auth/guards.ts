import 'server-only';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { can, type Permission } from '@/lib/roles';
import { PATH_HEADER } from '@/lib/request-path';
import { db } from '../db';
import { movedAddress, movedPath } from '../workspace-address';
import { findMembership, type Membership } from '../workspaces';
import { getSessionUser, requireUser, type SessionUser } from './session';

export interface WorkspaceAccess extends Membership {
  user: SessionUser;
}

/**
 * For pages under `/dashboard/[slug]`: the signed-in member and their role. Anyone else gets a 404, so
 * a workspace's existence is not revealed to people outside it. A member who opens an old
 * address of their workspace is sent on to the same page at the new one, for good (308).
 */
export async function requireWorkspace(
  slug: string,
  permission: Permission = 'envelopes.read',
): Promise<WorkspaceAccess> {
  const user = await requireUser(`/dashboard/${slug}`);
  const membership = await findMembership(db(), user.id, { slug });
  if (!membership) {
    const moved = await movedAddress(db(), user.id, slug);
    if (moved) permanentRedirect(movedPath((await headers()).get(PATH_HEADER), slug, moved));
    notFound();
  }
  if (!can(membership.role, permission)) notFound();
  return { ...membership, user };
}

/** For route handlers: the member and role, or null (answer 404) for anyone else. */
export async function findWorkspaceAccess(slug: string): Promise<WorkspaceAccess | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const membership = await findMembership(db(), user.id, { slug });
  return membership ? { ...membership, user } : null;
}

/**
 * The answer for a route handler whose workspace was not found: a permanent redirect when the
 * signed-in member used an old address, otherwise 404.
 */
export async function workspaceNotFound(request: Request, slug: string): Promise<Response> {
  const user = await getSessionUser();
  const moved = user ? await movedAddress(db(), user.id, slug) : null;
  if (!moved) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const location = movedPath(url.pathname + url.search, slug, moved);
  return new Response(null, { status: 308, headers: { location } });
}
