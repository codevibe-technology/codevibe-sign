import { SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/records/public-shell';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Record not available',
  robots: { index: false, follow: false },
};

export default function RecordNotFound() {
  return (
    <PublicShell>
      <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <SearchX aria-hidden className="mx-auto mb-3 h-8 w-8 text-muted" />
        <h1 className="text-[22px] font-bold text-ink">This record is not available</h1>
        <p className="mx-auto mt-2 max-w-md text-muted">
          The link may be incomplete, or the sender has turned the record off. If you hold the
          signed PDF, you can still check it.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link href="/verify">Check a signed PDF</Link>
          </Button>
        </div>
      </div>
    </PublicShell>
  );
}
