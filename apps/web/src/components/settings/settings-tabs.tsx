'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface SettingsTab {
  label: string;
  href: string;
}

export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings"
      className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0 lg:sticky lg:top-7 lg:mb-0 lg:overflow-visible"
    >
      <ul className="flex min-w-max gap-1 border-b border-line lg:min-w-0 lg:flex-col lg:gap-0.5 lg:border-b-0">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors lg:mb-0 lg:flex lg:rounded-md lg:border-b-0 lg:py-2',
                  active
                    ? 'border-primary text-primary lg:bg-primary-soft lg:shadow-[inset_3px_0_0_var(--accent)]'
                    : 'border-transparent text-muted hover:border-line-strong hover:text-ink lg:hover:bg-surface-2',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
