import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TemplateEditor } from '@/components/templates/template-editor';
import { editorStateFrom } from '@/lib/templates';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getTemplate } from '@/server/templates';

export const metadata: Metadata = { title: 'Edit template' };

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { workspace } = await requireWorkspace(slug, 'envelopes.write');
  const template = await getTemplate(db(), workspace.id, id);
  if (!template) notFound();
  if (template.archivedAt) redirect(`/dashboard/${slug}/templates?view=archived`);
  return (
    <TemplateEditor
      slug={slug}
      workspaceId={workspace.id}
      initial={editorStateFrom(template, template.definition)}
    />
  );
}
