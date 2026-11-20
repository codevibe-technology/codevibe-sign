import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BulkSendsCard } from '@/components/templates/bulk-sends-card';
import { TemplatesList } from '@/components/templates/templates-list';
import { Button } from '@/components/ui/button';
import { bulkSendView } from '@/lib/bulk-send';
import { cn } from '@/lib/cn';
import { can } from '@/lib/roles';
import { templateSummary } from '@/lib/templates';
import { requireWorkspace } from '@/server/auth/guards';
import { listBulkSends } from '@/server/bulk-sends';
import { db } from '@/server/db';
import { countTemplates, listTemplates } from '@/server/templates';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Templates' };

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const archived = (await searchParams).view === 'archived';
  const { workspace, role } = await requireWorkspace(slug);
  const sql = db();
  const [templates, counts, bulks] = await Promise.all([
    listTemplates(sql, workspace.id, { archived }),
    countTemplates(sql, workspace.id),
    listBulkSends(sql, workspace.id, { limit: 5 }),
  ]);
  const canWrite = can(role, 'envelopes.write');
  const tab = (active: boolean) =>
    cn(
      'inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition-colors',
      active
        ? 'border-nav bg-nav text-white shadow-[inset_0_-2px_0_var(--accent)]'
        : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
    );
  return (
    <>
      <PageHeader
        eyebrow="Reuse"
        title="Templates"
        description="Reusable documents with their roles and fields already placed."
        action={
          canWrite ? (
            <Button asChild>
              <Link href={`/w/${slug}/templates/new`}>
                <Plus aria-hidden className="h-4 w-4" />
                New template
              </Link>
            </Button>
          ) : null
        }
      />
      <nav aria-label="Template lists" className="mb-4 flex gap-1">
        <Link
          href={`/w/${slug}/templates`}
          className={tab(!archived)}
          aria-current={archived ? undefined : 'page'}
        >
          Active <span className="font-mono text-[11px] opacity-70">{counts.active}</span>
        </Link>
        <Link
          href={`/w/${slug}/templates?view=archived`}
          className={tab(archived)}
          aria-current={archived ? 'page' : undefined}
        >
          Archived <span className="font-mono text-[11px] opacity-70">{counts.archived}</span>
        </Link>
      </nav>
      <div className="space-y-6">
        <TemplatesList
          slug={slug}
          workspaceId={workspace.id}
          templates={templates.map(templateSummary)}
          archived={archived}
          canWrite={canWrite}
        />
        {bulks.length > 0 ? <BulkSendsCard slug={slug} bulks={bulks.map(bulkSendView)} /> : null}
      </div>
    </>
  );
}
