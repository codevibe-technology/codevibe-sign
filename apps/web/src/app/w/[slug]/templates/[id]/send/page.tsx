import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SendTemplateForm } from '@/components/templates/send-template-form';
import { PageHeader } from '@/components/ui/page-header';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getTemplate } from '@/server/templates';

export const metadata: Metadata = { title: 'Send from a template' };

export default async function SendTemplatePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { user, workspace } = await requireWorkspace(slug, 'envelopes.write');
  const template = await getTemplate(db(), workspace.id, id);
  if (!template) notFound();
  if (template.archivedAt) redirect(`/w/${slug}/templates?view=archived`);
  return (
    <>
      <PageHeader
        eyebrow="Templates"
        title={`Send: ${template.name}`}
        description="Say who takes each role. The documents and fields come from the template."
      />
      <SendTemplateForm
        slug={slug}
        workspaceId={workspace.id}
        template={{ id: template.id, name: template.name, definition: template.definition }}
        me={{ name: user.name, email: user.email }}
      />
    </>
  );
}
