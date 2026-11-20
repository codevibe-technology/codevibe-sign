'use client';

import { BookOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { BrandMark } from './brand-mark';
import { isActive, workspaceNav } from './nav';
import { UserMenu } from './user-menu';
import { WorkspaceSwitcher, type SwitcherWorkspace } from './workspace-switcher';

export interface SidebarProps {
  current: SwitcherWorkspace;
  workspaces: SwitcherWorkspace[];
  canCreate: boolean;
  onNavigate?: () => void;
}

const railItem =
  'relative flex w-full flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] leading-tight font-medium transition-colors';

/** A narrow navy rail: icons with their names below, workspace on top, account at the bottom. */
export function Sidebar({
  current,
  workspaces,
  canCreate,
  onNavigate,
  user,
}: SidebarProps & { user: { name: string; email: string } }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full w-[84px] flex-col items-center border-r border-white/5 bg-nav py-3 text-nav-ink">
      <Link
        href={`/w/${current.slug}`}
        onClick={onNavigate}
        aria-label="Codevibe Sign home"
        className="mb-3 rounded-md"
      >
        <BrandMark className="h-9 w-9" />
      </Link>
      <WorkspaceSwitcher current={current} workspaces={workspaces} canCreate={canCreate} />
      <span aria-hidden className="my-3 h-px w-10 bg-white/10" />
      <nav aria-label="Main" className="w-full flex-1 overflow-y-auto px-2">
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
                    railItem,
                    active
                      ? 'bg-nav-raised text-white before:absolute before:inset-y-2 before:-left-2 before:w-[3px] before:bg-accent'
                      : 'text-nav-muted hover:bg-nav-raised/60 hover:text-white',
                  )}
                >
                  <item.icon
                    aria-hidden
                    strokeWidth={1.8}
                    className={cn('h-5 w-5', active && 'text-accent')}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex w-full flex-col items-center gap-2 px-2 pt-2">
        <a
          href="/docs"
          className={cn(railItem, 'text-nav-muted hover:bg-nav-raised/60 hover:text-white')}
        >
          <BookOpen aria-hidden strokeWidth={1.8} className="h-5 w-5" />
          <span>Docs</span>
        </a>
        <UserMenu user={user} personalHref={`/w/${current.slug}/settings/personal`} />
      </div>
    </div>
  );
}
