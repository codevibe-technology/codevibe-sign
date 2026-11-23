'use client';

import { LocalTime } from '@/components/ui/local-time';
import { showActionError } from '@/components/billing/upgrade-toast';
import type { ActionResult } from '@/server/actions/action';
import {
  Archive,
  ArchiveRestore,
  Copy,
  FileText,
  LayoutTemplate,
  MoreHorizontal,
  PenLine,
  Send,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import type { TemplateSummary } from '@/lib/templates';
import { archiveTemplateAction, duplicateTemplateAction } from '@/server/actions/templates';

const item =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-2';

export function TemplatesList({
  slug,
  workspaceId,
  templates,
  archived,
  canWrite,
}: {
  slug: string;
  workspaceId: string;
  templates: TemplateSummary[];
  archived: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(work: () => Promise<ActionResult<unknown>>, success: string) {
    start(async () => {
      const result = await work();
      if (!result.ok) {
        showActionError(result);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  if (templates.length === 0) {
    return archived ? (
      <EmptyState
        icon={Archive}
        title="Nothing archived"
        description="Archived templates are kept here, out of the way, and can be restored at any time."
      />
    ) : (
      <EmptyState
        icon={LayoutTemplate}
        title="No templates yet"
        description="Save an offer letter, NDA or policy once, then send it to one person or a whole list in a few clicks."
        action={
          canWrite ? (
            <Button asChild>
              <Link href={`/dashboard/${slug}/templates/new`}>Create a template</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <Card>
      <ul
        className="divide-y divide-line"
        aria-label={archived ? 'Archived templates' : 'Templates'}
        aria-busy={pending || undefined}
      >
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center gap-3 px-4 py-4 sm:flex-nowrap sm:px-5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <LayoutTemplate aria-hidden className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold text-ink">{t.name}</span>
                {archived ? <Badge>Archived</Badge> : null}
              </p>
              {t.description ? (
                <p className="truncate text-sm text-muted">{t.description}</p>
              ) : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  <Users aria-hidden className="h-3.5 w-3.5" />
                  {t.roles.map((r) => r.name).join(', ')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <FileText aria-hidden className="h-3.5 w-3.5" />
                  {t.documentCount} {t.documentCount === 1 ? 'document' : 'documents'} ·{' '}
                  {t.pageCount} {t.pageCount === 1 ? 'page' : 'pages'}
                </span>
                <span>
                  Updated <LocalTime iso={t.updatedAt} format="relative" />
                </span>
              </p>
            </div>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              {canWrite && !archived ? (
                <>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/dashboard/${slug}/templates/${t.id}/bulk`}>
                      <Users aria-hidden className="h-4 w-4" />
                      Bulk send
                    </Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href={`/dashboard/${slug}/templates/${t.id}/send`}>
                      <Send aria-hidden className="h-4 w-4" />
                      Use
                    </Link>
                  </Button>
                </>
              ) : null}
              {canWrite ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                    aria-label={`More for ${t.name}`}
                  >
                    <MoreHorizontal aria-hidden className="h-5 w-5" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="z-50 w-52 rounded-lg border border-line bg-surface p-1.5 text-ink shadow-card"
                    >
                      {archived ? null : (
                        <DropdownMenu.Item asChild>
                          <Link href={`/dashboard/${slug}/templates/${t.id}/edit`} className={item}>
                            <PenLine aria-hidden className="h-4 w-4" /> Edit
                          </Link>
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Item
                        className={item}
                        onSelect={() =>
                          run(
                            () => duplicateTemplateAction({ workspaceId, templateId: t.id }),
                            `Copied as "${t.name} (copy)".`,
                          )
                        }
                      >
                        <Copy aria-hidden className="h-4 w-4" /> Duplicate
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="my-1 h-px bg-line" />
                      <DropdownMenu.Item
                        className={cn(item, archived ? undefined : 'text-danger')}
                        onSelect={() =>
                          run(
                            () =>
                              archiveTemplateAction({
                                workspaceId,
                                templateId: t.id,
                                archived: !archived,
                              }),
                            archived ? `"${t.name}" is back in the list.` : `"${t.name}" archived.`,
                          )
                        }
                      >
                        {archived ? (
                          <>
                            <ArchiveRestore aria-hidden className="h-4 w-4" /> Restore
                          </>
                        ) : (
                          <>
                            <Archive aria-hidden className="h-4 w-4" /> Archive
                          </>
                        )}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
