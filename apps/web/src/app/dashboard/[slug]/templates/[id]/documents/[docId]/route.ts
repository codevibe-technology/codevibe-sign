import { findWorkspaceAccess, workspaceNotFound } from '@/server/auth/guards';
import { db } from '@/server/db';
import { appRuntime } from '@/server/runtime';
import { getTemplate, readTemplateDocument } from '@/server/templates';

export const dynamic = 'force-dynamic';

/** A template's PDF, for members of its workspace; the field placer shows it. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string; docId: string }> },
) {
  const { slug, id, docId } = await params;
  const access = await findWorkspaceAccess(slug);
  if (!access) return workspaceNotFound(request, slug);
  const template = await getTemplate(db(), access.workspace.id, id);
  const bytes = template ? await readTemplateDocument(appRuntime().files, template, docId) : null;
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
    },
  });
}
