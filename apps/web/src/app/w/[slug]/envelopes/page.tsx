import { FileSignature } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireWorkspace } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Envelopes' };

export default async function EnvelopesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  return (
    <>
      <PageHeader
        title="Envelopes"
        description="Every document sent for signature from this workspace."
      />
      <EmptyState
        icon={FileSignature}
        title="No envelopes yet"
        description="An envelope is one or more documents sent to the people who need to sign them. Sending from the app arrives next; until then, use the API with a key from Settings."
      />
    </>
  );
}
