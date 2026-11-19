'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';

export interface SwitcherWorkspace {
  id: string;
  slug: string;
  name: string;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || '?';

export function WorkspaceAvatar({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-white">
      {initials(name)}
    </span>
  );
}

export function WorkspaceSwitcher({
  current,
  workspaces,
  canCreate,
}: {
  current: SwitcherWorkspace;
  workspaces: SwitcherWorkspace[];
  canCreate: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-nav-raised/50 px-2.5 py-2 text-left text-sm hover:bg-nav-raised"
        aria-label={`Workspace: ${current.name}. Switch workspace`}
      >
        <WorkspaceAvatar name={current.name} />
        <span className="min-w-0 flex-1 truncate font-semibold text-white">{current.name}</span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 text-nav-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-xl border border-line bg-surface p-1.5 text-ink shadow-card"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold text-muted uppercase">
            Workspaces
          </DropdownMenu.Label>
          {workspaces.map((workspace) => (
            <DropdownMenu.Item key={workspace.id} asChild>
              <Link
                href={`/w/${workspace.slug}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
              >
                <WorkspaceAvatar name={workspace.name} />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {workspace.id === current.id ? (
                  <Check aria-label="Current" className="h-4 w-4 text-primary" />
                ) : null}
              </Link>
            </DropdownMenu.Item>
          ))}
          {canCreate ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item asChild>
                <Link
                  href="/onboarding"
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-primary outline-none data-[highlighted]:bg-surface-2"
                >
                  <Plus aria-hidden className="h-4 w-4" /> New workspace
                </Link>
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
