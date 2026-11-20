import type { Metadata } from 'next';
import { TemplateEditor } from '@/components/templates/template-editor';
import { requireWorkspace } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'New template' };

export default async function NewTemplatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'envelopes.write');
  return <TemplateEditor slug={slug} workspaceId={workspace.id} />;
}
