'use client';

import { LocalTime } from '@/components/ui/local-time';
import {
  Ban,
  Download,
  Eye,
  FileSignature,
  MoreHorizontal,
  PenLine,
  Search,
  Send,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, NativeSelect } from '@/components/ui/field';
import { ApiError, apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import {
  STATUS_FILTERS,
  isFinalStatus,
  declineLine,
  peopleLine,
  progressOf,
  sortEnvelopes,
  SORTS,
  statusesFor,
  type EnvelopePage,
  type SortKey,
  type EnvelopeSummary,
  type StatusFilterKey,
} from '@/lib/envelopes';
import { remindAction } from '@/server/actions/envelopes';
import { TableSkeleton } from './skeletons';
import { StatusPill } from './status-pill';
import { VoidDialog } from './void-dialog';

export interface EnvelopesTableProps {
  slug: string;
  workspaceId: string;
  initial: EnvelopePage;
  initialStatus: StatusFilterKey | null;
  initialQuery: string;
  canWrite: boolean;
}

export function EnvelopesTable({
  slug,
  workspaceId,
  initial,
  initialStatus,
  initialQuery,
  canWrite,
}: EnvelopesTableProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initial.envelopes);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [status, setStatus] = useState<StatusFilterKey | null>(initialStatus);
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<SortKey>('newest');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [voiding, setVoiding] = useState<{ id: string; title: string }[] | null>(null);
  const request = useRef(0);
  const first = useRef(true);
  const shown = useRef(initial);
  const loaded = useRef(rows.length);
  useEffect(() => {
    loaded.current = rows.length;
  }, [rows.length]);

  const load = useCallback(
    async (opts: { cursor?: string | null; append?: boolean; refresh?: boolean } = {}) => {
      const ticket = ++request.current;
      // A refresh reloads as many rows as are on screen, so loaded pages stay loaded.
      const limit = opts.refresh ? Math.min(100, Math.max(25, loaded.current)) : 25;
      const params = new URLSearchParams({ limit: String(limit) });
      if (status) params.set('status', statusesFor(status).join(','));
      if (query.trim()) params.set('q', query.trim());
      if (opts.cursor) params.set('cursor', opts.cursor);
      if (opts.append) setLoadingMore(true);
      else if (!opts.refresh) setLoading(true);
      try {
        const page = await apiFetch<EnvelopePage>(workspaceId, `/v1/envelopes?${params}`);
        if (ticket !== request.current) return;
        setRows((prev) => (opts.append ? [...prev, ...page.envelopes] : page.envelopes));
        setCursor(page.nextCursor);
        setError(null);
        if (opts.refresh) {
          const ids = new Set(page.envelopes.map((e) => e.id));
          setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
        } else if (!opts.append) setSelected(new Set());
      } catch (err) {
        if (ticket !== request.current) return;
        setError(err instanceof ApiError ? err.message : 'The list could not be loaded.');
      } finally {
        if (ticket === request.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [workspaceId, status, query],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const url = new URL(window.location.href);
    if (status) url.searchParams.set('status', status);
    else url.searchParams.delete('status');
    if (query.trim()) url.searchParams.set('q', query.trim());
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', url);
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [status, query, load]);

  // The page passes fresh `initial` data after a refresh (a live update or an action); the
  // table reloads with its own filters and keeps what is selected.
  useEffect(() => {
    if (shown.current === initial) return;
    shown.current = initial;
    void load({ refresh: true });
  }, [initial, load]);

  const sorted = useMemo(() => sortEnvelopes(rows, sort), [rows, sort]);
  const voidable = (e: EnvelopeSummary) => canWrite && !isFinalStatus(e.status);
  const selectable = sorted.filter(voidable);
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));
  const filtering = status !== null || query.trim() !== '';

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function remind(envelopeId: string) {
    const result = await remindAction({ workspaceId, envelopeId });
    if (result.ok) toast.success('Reminder sent with a fresh signing link');
    else toast.error(result.error);
  }

  const href = (e: EnvelopeSummary) =>
    e.status === 'draft' && canWrite
      ? `/w/${slug}/envelopes/new?draft=${e.id}`
      : `/w/${slug}/envelopes/${e.id}`;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            aria-label="Search by title"
            placeholder="Search by title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="envelope-sort" className="text-sm text-muted">
            Sort
          </label>
          <NativeSelect
            id="envelope-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-auto"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div
        role="group"
        aria-label="Filter by status"
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {[{ key: null, label: 'All' }, ...STATUS_FILTERS].map((f) => {
          const active = status === f.key;
          return (
            <button
              key={f.key ?? 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(f.key as StatusFilterKey | null)}
              className={cn(
                'h-8 shrink-0 rounded-md border px-3 text-[13px] font-semibold transition-colors',
                active
                  ? 'border-nav bg-nav text-white shadow-[inset_0_-2px_0_var(--accent)]'
                  : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary-soft px-4 py-2.5 shadow-card md:top-3">
          <p className="text-sm font-semibold text-ink">{selected.size} selected</p>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              setVoiding(
                rows.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, title: r.title })),
              )
            }
          >
            <Ban aria-hidden className="h-4 w-4" />
            Void selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X aria-hidden className="h-4 w-4" />
            Clear
          </Button>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title="Nothing matches"
            description="No envelope has that title or status. Try another word or show all."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setStatus(null);
                }}
              >
                Show all envelopes
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FileSignature}
            title="No envelopes yet"
            description={
              canWrite
                ? 'An envelope is one or more PDFs sent to the people who need to sign them. Send your first one; it takes about a minute.'
                : 'Envelopes your team sends for signature will be listed here.'
            }
            action={
              canWrite ? (
                <Button asChild>
                  <Link href={`/w/${slug}/envelopes/new`}>
                    <Send aria-hidden className="h-4 w-4" />
                    Send a document
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-nav text-left font-mono text-[10.5px] font-medium tracking-[0.1em] text-nav-ink uppercase">
              <tr>
                {canWrite ? (
                  <th scope="col" className="w-11 py-3 pl-4">
                    <input
                      type="checkbox"
                      aria-label="Select all that can be voided"
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(selectable.map((e) => e.id)))
                      }
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3">
                  Envelope
                </th>
                <th scope="col" className="hidden w-44 px-4 py-3 md:table-cell">
                  Status
                </th>
                <th scope="col" className="hidden w-28 px-4 py-3 lg:table-cell">
                  Progress
                </th>
                <th scope="col" className="hidden w-28 px-4 py-3 sm:table-cell">
                  Created
                </th>
                <th scope="col" className="w-14 py-3 pr-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map((e) => {
                const progress = progressOf(e.recipients);
                return (
                  <tr
                    key={e.id}
                    className={cn(
                      'transition-colors hover:bg-surface-2/60',
                      selected.has(e.id) && 'bg-primary-soft/40',
                    )}
                  >
                    {canWrite ? (
                      <td className="py-3 pl-4 align-top sm:align-middle">
                        {voidable(e) ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${e.title}`}
                            checked={selected.has(e.id)}
                            onChange={() => toggle(e.id)}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <Link
                        href={href(e)}
                        className="block truncate font-semibold text-ink hover:text-primary"
                      >
                        {e.title}
                      </Link>
                      <p className="truncate text-muted">
                        {peopleLine(e.recipients.map((r) => r.name))}
                        {e.documents.length > 1 ? ` · ${e.documents.length} documents` : ''}
                      </p>
                      {declineLine(e) ? (
                        <p className="truncate text-danger" title={declineLine(e)!}>
                          {declineLine(e)}
                        </p>
                      ) : null}
                      <div className="mt-1.5 md:hidden">
                        <StatusPill status={e.status} />
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <StatusPill status={e.status} />
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      {progress.total > 0 ? (
                        <div>
                          <p className="font-mono text-[12px] text-ink">
                            {progress.done} of {progress.total}
                          </p>
                          <div className="mt-1.5 h-1 w-20 overflow-hidden bg-surface-2">
                            <div
                              className="h-full bg-accent"
                              style={{ width: `${(progress.done / progress.total) * 100}%` }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 text-muted sm:table-cell">
                      <LocalTime iso={e.createdAt} format="relative" />
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <RowActions
                        envelope={e}
                        slug={slug}
                        canWrite={canWrite}
                        onRemind={() => void remind(e.id)}
                        onVoid={() => setVoiding([{ id: e.id, title: e.title }])}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cursor ? (
            <div className="flex justify-center border-t border-line bg-surface-2/40 px-4 py-3">
              <Button
                variant="secondary"
                size="sm"
                pending={loadingMore}
                onClick={() => void load({ cursor, append: true })}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </Card>
      )}

      <VoidDialog
        workspaceId={workspaceId}
        envelopes={voiding ?? []}
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        onDone={() => {
          setSelected(new Set());
          void load();
          router.refresh();
        }}
      />
    </div>
  );
}

function RowActions({
  envelope: e,
  slug,
  canWrite,
  onRemind,
  onVoid,
}: {
  envelope: EnvelopeSummary;
  slug: string;
  canWrite: boolean;
  onRemind: () => void;
  onVoid: () => void;
}) {
  const item =
    'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-2';
  const open = e.status === 'sent' || e.status === 'in_progress';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        aria-label={`Actions for ${e.title}`}
      >
        <MoreHorizontal aria-hidden className="h-5 w-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-56 rounded-lg border border-line bg-surface p-1.5 text-ink shadow-card"
        >
          <DropdownMenu.Item asChild>
            <Link href={`/w/${slug}/envelopes/${e.id}`} className={item}>
              <Eye aria-hidden className="h-4 w-4" /> Open details
            </Link>
          </DropdownMenu.Item>
          {e.status === 'draft' && canWrite ? (
            <DropdownMenu.Item asChild>
              <Link href={`/w/${slug}/envelopes/new?draft=${e.id}`} className={item}>
                <PenLine aria-hidden className="h-4 w-4" /> Continue editing
              </Link>
            </DropdownMenu.Item>
          ) : null}
          {e.status === 'completed' && e.documents[0] ? (
            <DropdownMenu.Item asChild>
              <a
                href={`/w/${slug}/envelopes/${e.id}/documents/${e.documents[0].id}?version=sealed`}
                className={item}
              >
                <Download aria-hidden className="h-4 w-4" /> Download signed PDF
              </a>
            </DropdownMenu.Item>
          ) : null}
          {open && canWrite ? (
            <DropdownMenu.Item className={item} onSelect={onRemind}>
              <Send aria-hidden className="h-4 w-4" /> Remind signers
            </DropdownMenu.Item>
          ) : null}
          {!isFinalStatus(e.status) && canWrite ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item className={cn(item, 'text-danger')} onSelect={onVoid}>
                <Ban aria-hidden className="h-4 w-4" /> Void…
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
