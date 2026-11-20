import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { BulkSendForm } from '@/components/templates/bulk-send-form';
import { BulkSendsCard } from '@/components/templates/bulk-sends-card';
import { PageHeader } from '@/components/ui/page-header';
import { MAX_BULK_ROWS, bulkSendView } from '@/lib/bulk-send';
import { requireWorkspace } from '@/server/auth/guards';
import { listBulkSends } from '@/server/bulk-sends';
import { db } from '@/server/db';
import { getTemplate } from '@/server/templates';

export const metadata: Metadata = { title: 'Bulk send' };

export default async function BulkSendPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { workspace } = await requireWorkspace(slug, 'envelopes.write');
  const sql = db();
  const template = await getTemplate(sql, workspace.id, id);
  if (!template) notFound();
  if (template.archivedAt) redirect(`/w/${slug}/templates?view=archived`);
  const earlier = await listBulkSends(sql, workspace.id, { templateId: template.id, limit: 5 });
  return (
    <>
      <PageHeader
        eyebrow="Templates"
        title={`Bulk send: ${template.name}`}
        description={`One envelope per row of a CSV file, up to ${MAX_BULK_ROWS} at a time. Each person gets their own copy to sign.`}
      />
      <div className="space-y-6">
        <BulkSendForm
          slug={slug}
          workspaceId={workspace.id}
          template={{ id: template.id, name: template.name, definition: template.definition }}
        />
        {earlier.length > 0 ? (
          <BulkSendsCard
            slug={slug}
            bulks={earlier.map(bulkSendView)}
            title="Earlier bulk sends of this template"
          />
        ) : null}
      </div>
    </>
  );
}
