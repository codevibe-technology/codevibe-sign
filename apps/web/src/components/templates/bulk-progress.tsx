'use client';

import { Ban, Download, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import {
  bulkProgress,
  bulkStatusLabel,
  rowPeopleLine,
  type BulkRowView,
  type BulkSendView,
} from '@/lib/bulk-send';
import { cn } from '@/lib/cn';
import type { TemplateRoleDef } from '@/lib/templates';
import { bulkSendStatusAction, cancelBulkSendAction } from '@/server/actions/templates';
import { BulkRowPill, BulkStatusPill } from './bulk-status-pill';

export const POLL_MS = 2000;

/** The rows that were not sent, as a CSV to fix and upload again. */
export function notSentCsv(rows: BulkRowView[], roles: Pick<TemplateRoleDef, 'id' | 'name'>[]) {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const header = [
    ...roles.flatMap((r) => [`${r.name} name`, `${r.name} email`, `${r.name} phone`]),
    'Problem',
  ];
  const lines = rows
    .filter((r) => r.status === 'failed')
    .map((r) =>
      [
        ...roles.flatMap((role) => {
          const p = r.people[role.id];
          return [p?.name ?? '', p?.email ?? '', p?.phone ?? ''];
        }),
        r.error ?? '',
      ]
        .map(cell)
        .join(','),
    );
  return `${header.map(cell).join(',')}\n${lines.join('\n')}\n`;
}

/** Follows a bulk send while it runs, then lists what happened to every row. */
export function BulkProgress({
  slug,
  workspaceId,
  initial,
  initialRows,
  roles,
  canWrite,
}: {
  slug: string;
  workspaceId: string;
  initial: BulkSendView;
  initialRows: BulkRowView[];
  roles: Pick<TemplateRoleDef, 'id' | 'name'>[];
  canWrite: boolean;
}) {
  const [bulk, setBulk] = useState(initial);
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<'all' | 'failed'>('all');
  const [stopping, setStopping] = useState(false);

  const refresh = useCallback(async () => {
    const result = await bulkSendStatusAction({ workspaceId, bulkId: bulk.id });
    if (!result.ok) return;
    setBulk(result.data.bulk);
    setRows(result.data.rows);
  }, [workspaceId, bulk.id]);

  useEffect(() => {
    if (bulk.status !== 'sending') return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [bulk.status, refresh]);

  async function stop() {
    if (!window.confirm('Stop sending? Envelopes already sent stay sent.')) return;
    setStopping(true);
    try {
      const result = await cancelBulkSendAction({ workspaceId, bulkId: bulk.id });
      if (!result.ok) toast.error(result.error);
      else toast.success('Stopped. Nothing more will be sent.');
      await refresh();
    } finally {
      setStopping(false);
    }
  }

  function download() {
    const blob = new Blob([notSentCsv(rows, roles)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'not-sent.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const progress = bulkProgress(bulk);
  const shown = filter === 'failed' ? rows.filter((r) => r.status === 'failed') : rows;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <BulkStatusPill bulk={bulk} />
              <span className="font-semibold" aria-live="polite">
                {bulkStatusLabel(bulk)}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {bulk.sent} sent · {bulk.failed} not sent · {bulk.total - bulk.sent - bulk.failed}{' '}
              waiting
              {bulk.createdByName ? ` · started by ${bulk.createdByName}` : ''}
            </p>
          </div>
          {bulk.status === 'sending' && canWrite ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void stop()}
              pending={stopping}
            >
              <Ban aria-hidden className="h-4 w-4" />
              Stop
            </Button>
          ) : null}
        </div>
        <div className="px-5 pb-5">
          <div
            role="progressbar"
            aria-label="Bulk send progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-2.5 w-full overflow-hidden rounded-[2px] bg-surface-2"
          >
            <div
              className={cn(
                'h-full transition-[width] duration-500 motion-reduce:transition-none',
                bulk.failed > 0 && bulk.status !== 'sending' ? 'bg-warning' : 'bg-primary',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          {bulk.status === 'sending' ? (
            <p className="mt-2 text-sm text-muted">
              You can leave this page; sending carries on. About 60 envelopes go out a minute.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Results"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Show"
                className="flex rounded-lg border border-line-strong p-0.5"
              >
                {(['all', 'failed'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-sm font-semibold',
                      filter === value ? 'bg-surface-2 text-ink' : 'text-muted',
                    )}
                  >
                    {value === 'all' ? `All ${rows.length}` : `Not sent ${bulk.failed}`}
                  </button>
                ))}
              </div>
              {bulk.failed > 0 && roles.length > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={download}>
                  <Download aria-hidden className="h-4 w-4" />
                  Not-sent rows
                </Button>
              ) : null}
            </div>
          }
        />
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Rows">
            {shown.map((row) => (
              <li
                key={row.line}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm"
              >
                <span className="w-14 shrink-0 text-muted">Row {row.line}</span>
                <span className="min-w-0 flex-1 break-words sm:truncate">
                  {rowPeopleLine(row.people, roles) || 'Unnamed'}
                </span>
                <BulkRowPill status={row.status} />
                {row.envelopeId ? (
                  <Link
                    href={`/dashboard/${slug}/envelopes/${row.envelopeId}`}
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    Envelope <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
                {row.error ? <p className="w-full pl-[4.25rem] text-danger">{row.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
