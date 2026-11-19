'use client';

import { Menu } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Sidebar, type SidebarProps } from './sidebar';
import { UserMenu } from './user-menu';

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
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 md:block">
        <Sidebar {...sidebar} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-8">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger
              className="-ml-1 rounded-lg p-2 text-ink hover:bg-surface-2 md:hidden"
              aria-label="Open navigation"
            >
              <Menu aria-hidden className="h-5 w-5" />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0D1B2A]/50 md:hidden" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] md:hidden">
                <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Sections of the workspace
                </Dialog.Description>
                <Sidebar {...sidebar} onNavigate={() => setOpen(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <p className="min-w-0 flex-1 truncate font-display font-semibold text-ink">
            {sidebar.current.name}
          </p>
          <UserMenu user={user} personalHref={`/w/${sidebar.current.slug}/settings/personal`} />
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
