import { LayoutTemplate } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireWorkspace } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Templates' };

export default async function TemplatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable documents with their signers and fields already placed."
      />
      <EmptyState
        icon={LayoutTemplate}
        title="No templates yet"
        description="Save an offer letter, NDA or policy once, then send it to one person or a whole list in a few clicks."
      />
    </>
  );
}
