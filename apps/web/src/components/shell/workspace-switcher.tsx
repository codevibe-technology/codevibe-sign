'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';

export interface SwitcherWorkspace {
  id: string;
  slug: string;
  name: string;
  /** The logo from Settings, Brand; the workspace's initials stand in when there is none. */
  logoUrl?: string | null;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || '?';

const tile = 'h-8 w-8 shrink-0 rounded-md border';

/**
 * The workspace's logo in a fixed square, whole and undistorted, or its initials. The tile
 * has the same size either way, so nothing moves when the image arrives or fails to.
 */
export function WorkspaceAvatar({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (logoUrl && failed !== logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        width={32}
        height={32}
        decoding="async"
        onError={() => setFailed(logoUrl)}
        className={`${tile} border-black/10 bg-white object-contain p-0.5`}
      />
    );
  }
  return (
    <span
      className={`${tile} flex items-center justify-center border-white/15 bg-nav-raised font-display text-xs font-bold text-white`}
    >
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
        className="flex w-[72px] flex-col items-center gap-1 rounded-md px-1 py-1.5 text-center hover:bg-nav-raised"
        aria-label={`Workspace: ${current.name}. Switch workspace`}
        title={current.name}
      >
        <span className="relative">
          <WorkspaceAvatar name={current.name} logoUrl={current.logoUrl} />
          <ChevronsUpDown
            aria-hidden
            className="absolute -right-2 -bottom-1 h-3.5 w-3.5 rounded-sm bg-nav p-px text-nav-muted"
          />
        </span>
        <span className="w-full truncate text-[10.5px] leading-tight font-medium text-nav-muted">
          {current.name}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={10}
          className="z-50 w-64 rounded-lg border border-line bg-surface p-1.5 text-ink shadow-card"
        >
          <DropdownMenu.Label className="eyebrow px-2 py-1.5">Workspaces</DropdownMenu.Label>
          {workspaces.map((workspace) => (
            <DropdownMenu.Item key={workspace.id} asChild>
              <Link
                href={`/dashboard/${workspace.slug}`}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
              >
                <WorkspaceAvatar name={workspace.name} logoUrl={workspace.logoUrl} />
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
                  className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium text-primary outline-none data-[highlighted]:bg-surface-2"
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
