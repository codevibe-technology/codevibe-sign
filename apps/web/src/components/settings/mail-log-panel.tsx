import { Mail } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  MAIL_LOG_LIMIT,
  MAIL_LOG_RETENTION_DAYS,
  formatBytes,
  mailKindLabel,
  mailTime,
  type MailLogStatus,
} from '@/lib/mail-log';

export interface MailLogRow {
  id: string;
  envelopeId: string | null;
  kind: string;
  recipientEmail: string;
  subject: string;
  providerMessageId: string | null;
  status: MailLogStatus;
  error: string | null;
  attachmentCount: number;
  attachmentBytes: number;
  createdAt: string;
}

function StatusLabel({ status }: { status: MailLogStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[3px] px-2 py-[3px] font-mono text-[10.5px] font-medium tracking-[0.06em] whitespace-nowrap uppercase',
        status === 'sent' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 bg-current" />
      {status === 'sent' ? 'Sent' : 'Failed'}
    </span>
  );
}

/** Settings → Email log: what the workspace sent, newest first, without bodies or links. */
export function MailLogPanel({
  slug,
  rows,
  envelopeId,
}: {
  slug: string;
  rows: MailLogRow[];
  envelopeId: string | null;
}) {
  const base = `/w/${slug}/settings/email-log`;
  return (
    <Card>
      <CardHeader
        title="Email log"
        description={`Every email sent for this workspace in the last ${MAIL_LOG_RETENTION_DAYS} days, latest ${MAIL_LOG_LIMIT} shown. Message text and links are never kept.`}
      />
      <form action={base} method="get" className="flex flex-wrap items-center gap-2 px-5 py-3">
        <label htmlFor="mail-log-envelope" className="text-sm font-medium text-ink">
          Envelope id
        </label>
        <Input
          id="mail-log-envelope"
          name="envelope"
          defaultValue={envelopeId ?? ''}
          placeholder="All envelopes"
          className="max-w-xs"
        />
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {envelopeId ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={base}>Show all</Link>
          </Button>
        ) : null}
      </form>
      {rows.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState
            icon={Mail}
            title="No emails yet"
            description={
              envelopeId
                ? 'Nothing was emailed for this envelope in the retention period.'
                : 'Signing requests, reminders, copies and invitations show up here once they are sent.'
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">
                  {mailKindLabel(row.kind)}
                  <span className="ml-2 font-normal text-muted">to {row.recipientEmail}</span>
                </p>
                <p className="truncate text-muted" title={row.subject}>
                  {row.subject}
                </p>
                {row.error ? <p className="mt-1 break-words text-danger">{row.error}</p> : null}
                <p className="mt-1 text-xs text-muted">
                  {row.attachmentCount > 0
                    ? `${row.attachmentCount} attached (${formatBytes(row.attachmentBytes)}) · `
                    : ''}
                  {row.envelopeId ? (
                    <Link
                      href={`/w/${slug}/envelopes/${row.envelopeId}`}
                      className="text-primary underline underline-offset-2"
                    >
                      Open envelope
                    </Link>
                  ) : null}
                  {row.providerMessageId ? (
                    <span className="ml-2 break-all" title="Message-ID">
                      {row.providerMessageId}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusLabel status={row.status} />
                <time dateTime={row.createdAt} className="text-xs text-muted">
                  {mailTime(row.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
