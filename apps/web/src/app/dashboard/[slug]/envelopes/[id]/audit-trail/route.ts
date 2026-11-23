import { findWorkspaceAccess, workspaceNotFound } from '@/server/auth/guards';
import { signApi, userPrincipal } from '@/server/sign/api';

export const dynamic = 'force-dynamic';

/**
 * The envelope's audit trail as a PDF, with the network address of each event: the same file
 * the completed-copy email carries. For members of the workspace only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const access = await findWorkspaceAccess(slug);
  if (!access) return workspaceNotFound(request, slug);
  const res = await signApi(userPrincipal(access.user.id, access.workspace.id, true)).auditTrail(
    id,
  );
  if (!res.ok) return new Response('Not found', { status: res.status === 409 ? 409 : 404 });
  return new Response(res.body, { status: 200, headers: res.headers });
}
