'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AddressField, blocksSubmit, useAddressCheck } from '@/components/workspace/address-field';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/dialog';
import { ADDRESS_COOL_DOWN_DAYS } from '@/lib/workspace-address';
import { changeWorkspaceAddressAction } from '@/server/actions/workspace';

/**
 * "Change address": the new part of the link, checked while it is typed, with what changes
 * and what does not spelled out before anyone confirms.
 */
export function ChangeAddressDialog({
  workspace,
  host,
}: {
  workspace: { id: string; slug: string };
  host: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(workspace.slug);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const check = useAddressCheck(slug, workspace);
  const unchanged = slug === workspace.slug;

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      setSlug(workspace.slug);
      setError(undefined);
    }
  }

  function confirm() {
    if (unchanged || blocksSubmit(check)) return;
    start(async () => {
      const result = await changeWorkspaceAddressAction({ workspaceId: workspace.id, slug });
      if (!result.ok) {
        if (result.field === 'slug') setError(result.error);
        else toast.error(result.error);
        return;
      }
      const prefix = `/dashboard/${workspace.slug}`;
      const here = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
      setOpen(false);
      toast.success('Address changed. Old links now lead to the new one.');
      router.replace(`/dashboard/${result.data.slug}${here}`);
    });
  }

  return (
    <DialogRoot open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          Change address
        </Button>
      </DialogTrigger>
      {open ? (
        <DialogContent
          title="Change the workspace address"
          description="Only the last part of the link changes."
        >
          <div
            className="space-y-4"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                event.preventDefault();
                confirm();
              }
            }}
          >
            <AddressField
              label="New address"
              host={host}
              value={slug}
              onChange={(value) => {
                setSlug(value);
                setError(undefined);
              }}
              check={check}
              error={error}
              autoFocus
            />
            <ul className="space-y-1.5 rounded-lg bg-surface-2 px-4 py-3 text-[13.5px] text-ink">
              <li>Links in emails already sent keep working.</li>
              <li>Bookmarks and old links to /dashboard/{workspace.slug} redirect here.</li>
              <li>API keys, webhooks and signing links are not affected.</li>
              <li>
                No other workspace can take /dashboard/{workspace.slug} for {ADDRESS_COOL_DOWN_DAYS}{' '}
                days.
              </li>
            </ul>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={confirm}
                pending={pending}
                disabled={unchanged || blocksSubmit(check) || check.status === 'checking'}
              >
                {pending ? 'Changing…' : 'Change address'}
              </Button>
            </div>
          </div>
        </DialogContent>
      ) : null}
    </DialogRoot>
  );
}
