import { LocalTime } from '@/components/ui/local-time';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BulkProgress } from '@/components/templates/bulk-progress';
import { PageHeader } from '@/components/ui/page-header';
import { bulkSendView } from '@/lib/bulk-send';
import { can } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { getBulkSend, listBulkRows } from '@/server/bulk-sends';
import { db } from '@/server/db';
import { getTemplate } from '@/server/templates';

export const metadata: Metadata = { title: 'Bulk send' };

export default async function BulkSendProgressPage({
  params,
}: {
  params: Promise<{ slug: string; bulkId: string }>;
}) {
  const { slug, bulkId } = await params;
  const { workspace, role } = await requireWorkspace(slug);
  const sql = db();
  const bulk = await getBulkSend(sql, workspace.id, bulkId);
  if (!bulk) notFound();
  const [rows, template] = await Promise.all([
    listBulkRows(sql, bulk.id),
    getTemplate(sql, workspace.id, bulk.templateId),
  ]);
  return (
    <>
      <Link
        href={`/w/${slug}/templates`}
        className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" /> Templates
      </Link>
      <PageHeader
        eyebrow="Templates"
        title={`Bulk send: ${bulk.templateName}`}
        description={
          <>
            {bulk.total} {bulk.total === 1 ? 'envelope' : 'envelopes'}, started{' '}
            <LocalTime iso={bulk.createdAt.toISOString()} />.
          </>
        }
      />
      <BulkProgress
        slug={slug}
        workspaceId={workspace.id}
        initial={bulkSendView(bulk)}
        initialRows={rows}
        roles={template?.definition.roles ?? []}
        canWrite={can(role, 'envelopes.write')}
      />
    </>
  );
}
