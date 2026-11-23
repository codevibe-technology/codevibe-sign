import { findWorkspaceAccess, workspaceNotFound } from '@/server/auth/guards';
import { AppError } from '@/server/errors';
import { signApi, userPrincipal } from '@/server/sign/api';

export const dynamic = 'force-dynamic';

/** The completion certificate as a JSON file. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const access = await findWorkspaceAccess(slug);
  if (!access) return workspaceNotFound(request, slug);
  try {
    const certificate = await signApi(
      userPrincipal(access.user.id, access.workspace.id, true),
    ).certificate(id);
    return new Response(JSON.stringify(certificate, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="certificate-${id.replace(/[^\w-]/g, '')}.json"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response('Not found', { status: 404 });
    throw err;
  }
}
