import type { Metadata } from 'next';
import { VerifyPanel } from '@/components/envelopes/verify-panel';
import { PageHeader } from '@/components/ui/page-header';
import { requireWorkspace } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Verify a document' };

export default async function VerifyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  return (
    <>
      <PageHeader
        eyebrow="Trust"
        title="Verify a document"
        description="Check that a signed PDF is exactly the one this workspace sealed, with nothing changed since."
      />
      <div className="max-w-2xl">
        <VerifyPanel workspaceId={workspace.id} slug={slug} />
      </div>
    </>
  );
}
