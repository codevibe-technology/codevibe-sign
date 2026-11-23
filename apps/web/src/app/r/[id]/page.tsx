import { Hourglass } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicRecord } from '@/components/records/public-record';
import { PublicShell } from '@/components/records/public-shell';
import { recordView, recordViewAllowed } from '@/server/public-record-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Signing record',
  description: 'The record of a document completed with Codevibe Sign.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

/** The page a certificate's QR code opens: the public record of one completed signing. */
export default async function PublicRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await recordViewAllowed(await headers()))) {
    return (
      <PublicShell>
        <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-card">
          <Hourglass aria-hidden className="mx-auto mb-3 h-8 w-8 text-muted" />
          <h1 className="text-[20px] font-bold text-ink">Too many records opened from here</h1>
          <p className="mt-2 text-muted">Wait a few minutes, then open the link again.</p>
        </div>
      </PublicShell>
    );
  }
  const view = await recordView(id);
  if (!view) notFound();
  return (
    <PublicShell>
      <PublicRecord view={view} />
    </PublicShell>
  );
}
