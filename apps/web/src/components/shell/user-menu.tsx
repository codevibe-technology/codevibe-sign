'use client';

import { LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import type { Theme } from '@/lib/preferences';
import { updatePreferencesAction } from '@/server/actions/personal';
import { applyTheme } from './theme';

const THEME_ITEMS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function UserMenu({
  user,
  personalHref,
}: {
  user: { name: string; email: string };
  personalHref: string;
}) {
  const router = useRouter();
  const item =
    'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-2';

  async function setTheme(theme: Theme) {
    applyTheme(theme);
    const result = await updatePreferencesAction({ theme });
    if (!result.ok) toast.error(result.error);
  }

  async function signOut() {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex h-10 w-10 items-center justify-center rounded-full bg-accent font-display text-sm font-bold text-accent-ink ring-2 ring-white/10 hover:ring-accent/50"
        aria-label="Account menu"
      >
        {(user.name || user.email).slice(0, 1).toUpperCase()}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="end"
          sideOffset={12}
          className="z-50 w-64 rounded-lg border border-line bg-surface p-1.5 text-ink shadow-card"
        >
          <div className="px-2 py-2">
            <p className="truncate text-sm font-semibold">{user.name || 'Your account'}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link href={personalHref} className={item}>
              <UserRound aria-hidden className="h-4 w-4" /> Personal settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Label className="eyebrow px-2 pt-2 pb-1">Theme</DropdownMenu.Label>
          {THEME_ITEMS.map(({ value, label, icon: Icon }) => (
            <DropdownMenu.Item key={value} className={item} onSelect={() => void setTheme(value)}>
              <Icon aria-hidden className="h-4 w-4" /> {label}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={item} onSelect={() => void signOut()}>
            <LogOut aria-hidden className="h-4 w-4" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
