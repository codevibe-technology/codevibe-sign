import { findWorkspaceAccess } from '@/server/auth/guards';
import { signApi, userPrincipal } from '@/server/sign/api';

export const dynamic = 'force-dynamic';

/** The original or sealed PDF (`?version=`), for members of the workspace only. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string; docId: string }> },
) {
  const { slug, id, docId } = await params;
  const access = await findWorkspaceAccess(slug);
  if (!access) return new Response('Not found', { status: 404 });
  const version = new URL(request.url).searchParams.get('version');
  const res = await signApi(userPrincipal(access.user.id, access.workspace.id, true)).document(
    id,
    docId,
    version === 'sealed' || version === 'original' ? version : undefined,
  );
  if (!res.ok) return new Response('Not found', { status: res.status === 409 ? 409 : 404 });
  return new Response(res.body, { status: 200, headers: res.headers });
}
