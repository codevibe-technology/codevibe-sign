import { Send } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EnvelopesTable } from '@/components/envelopes/envelopes-table';
import { LiveUpdates } from '@/components/live/live-updates';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { isStatusFilter, statusesFor } from '@/lib/envelopes';
import { can } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { signApi, userPrincipal } from '@/server/sign/api';

export const metadata: Metadata = { title: 'Envelopes' };

export default async function EnvelopesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const { user, workspace, role } = await requireWorkspace(slug);
  const status = isStatusFilter(search.status) ? search.status : null;
  const query = typeof search.q === 'string' ? search.q.slice(0, 200) : '';
  const canWrite = can(role, 'envelopes.write');
  const initial = await signApi(userPrincipal(user.id, workspace.id, true)).list({
    ...(status ? { status: statusesFor(status) } : {}),
    ...(query.trim() ? { q: query.trim() } : {}),
  });
  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Envelopes"
        description="Every document sent for signature from this workspace."
        badge={<LiveUpdates workspaceId={workspace.id} />}
        action={
          canWrite ? (
            <Button asChild>
              <Link href={`/w/${slug}/envelopes/new`}>
                <Send aria-hidden className="h-4 w-4" />
                Send a document
              </Link>
            </Button>
          ) : null
        }
      />
      <EnvelopesTable
        key={`${status ?? 'all'}:${query}`}
        slug={slug}
        workspaceId={workspace.id}
        initial={initial}
        initialStatus={status}
        initialQuery={query}
        canWrite={canWrite}
      />
    </>
  );
}
