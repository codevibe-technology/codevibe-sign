'use client';

import { Menu } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { hasName } from '@/lib/person-name';
import { Wordmark } from './brand-mark';
import { NamePrompt } from './name-prompt';
import { Sidebar, type SidebarProps } from './sidebar';

export function AppShell({
  sidebar,
  user,
  children,
}: {
  sidebar: SidebarProps;
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 z-30 hidden h-dvh shrink-0 md:block">
        <Sidebar {...sidebar} user={user} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones only: the rail opens from here. */}
        <div className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-nav px-3 text-white md:hidden">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger
              className="rounded-md p-2 hover:bg-nav-raised"
              aria-label="Open navigation"
            >
              <Menu aria-hidden className="h-5 w-5" />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0D1B2A]/50 md:hidden" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 md:hidden">
                <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Sections of the workspace
                </Dialog.Description>
                <Sidebar {...sidebar} user={user} onNavigate={() => setOpen(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <Wordmark />
          <span className="ml-auto min-w-0 truncate text-sm text-nav-muted">
            {sidebar.current.name}
          </span>
        </div>
        <main
          id="main"
          className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-7 lg:px-10"
        >
          {hasName(user) ? null : <NamePrompt />}
          {children}
        </main>
      </div>
    </div>
  );
}
