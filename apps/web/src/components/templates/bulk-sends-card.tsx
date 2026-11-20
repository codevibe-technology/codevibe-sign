import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/card';
import { bulkProgress, bulkStatusLabel, type BulkSendView } from '@/lib/bulk-send';
import { relativeTime } from '@/lib/envelopes';
import { BulkStatusPill } from './bulk-status-pill';

/** The latest bulk sends, each linking to its progress and results. */
export function BulkSendsCard({
  slug,
  bulks,
  title = 'Recent bulk sends',
}: {
  slug: string;
  bulks: BulkSendView[];
  title?: string;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-line">
        {bulks.map((b) => (
          <li key={b.id}>
            <Link
              href={`/w/${slug}/templates/bulk/${b.id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-ink">{b.templateName}</span>
                  <BulkStatusPill bulk={b} />
                </p>
                <p className="text-sm text-muted">
                  {bulkStatusLabel(b)} · {b.total} {b.total === 1 ? 'envelope' : 'envelopes'} ·{' '}
                  {relativeTime(b.createdAt)}
                  {b.createdByName ? ` by ${b.createdByName}` : ''}
                </p>
                {b.status === 'sending' ? (
                  <div
                    className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-2"
                    aria-hidden
                  >
                    <div className="h-full bg-primary" style={{ width: `${bulkProgress(b)}%` }} />
                  </div>
                ) : null}
              </div>
              <ChevronRight aria-hidden className="h-4 w-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
