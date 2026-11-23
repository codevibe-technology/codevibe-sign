import {
  FileSignature,
  LayoutDashboard,
  LayoutTemplate,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Active only on the exact path, not on pages below it. */
  exact?: boolean;
}

export const workspaceNav = (slug: string): NavItem[] => [
  { label: 'Dashboard', href: `/dashboard/${slug}`, icon: LayoutDashboard, exact: true },
  { label: 'Envelopes', href: `/dashboard/${slug}/envelopes`, icon: FileSignature },
  { label: 'Templates', href: `/dashboard/${slug}/templates`, icon: LayoutTemplate },
  { label: 'Verify', href: `/dashboard/${slug}/verify`, icon: ShieldCheck },
  { label: 'Settings', href: `/dashboard/${slug}/settings`, icon: Settings },
];

export const isActive = (item: NavItem, pathname: string) =>
  item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
