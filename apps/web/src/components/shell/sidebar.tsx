'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Wordmark } from './brand-mark';
import { isActive, workspaceNav } from './nav';
import { WorkspaceSwitcher, type SwitcherWorkspace } from './workspace-switcher';

export interface SidebarProps {
  current: SwitcherWorkspace;
  workspaces: SwitcherWorkspace[];
  canCreate: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ current, workspaces, canCreate, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-nav text-nav-ink">
      <div className="px-5 pt-5 pb-4">
        <Link href={`/w/${current.slug}`} onClick={onNavigate} className="inline-flex rounded-md">
          <Wordmark />
        </Link>
      </div>
      <div className="px-3">
        <WorkspaceSwitcher current={current} workspaces={workspaces} canCreate={canCreate} />
      </div>
      <nav aria-label="Main" className="mt-5 flex-1 px-3">
        <ul className="space-y-1">
          {workspaceNav(current.slug).map((item) => {
            const active = isActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-nav-raised text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r before:bg-accent'
                      : 'text-nav-muted hover:bg-nav-raised/60 hover:text-white',
                  )}
                >
                  <item.icon
                    aria-hidden
                    className={cn('h-[18px] w-[18px]', active && 'text-accent')}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="flex items-center gap-2 px-5 py-4 text-xs text-nav-muted">
        <a href="/docs" className="font-semibold text-nav-ink hover:underline">
          Docs
        </a>
        <span aria-hidden>·</span>
        Open source · AGPL-3.0
      </p>
    </div>
  );
}
