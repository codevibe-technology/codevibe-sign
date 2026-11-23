import { Menu } from 'lucide-react';
import Link from 'next/link';
import { Wordmark } from '@/components/shell/brand-mark';
import { UserMenu } from '@/components/shell/user-menu';
import { Button } from '@/components/ui/button';
import { APP_HOME } from '@/lib/safe-next';
import { ExternalLink } from './external-link';
import { DOCS_URL } from './links';
import { type SectionLink, SectionLinks } from './section-links';

export const SECTIONS: SectionLink[] = [
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Aadhaar eSign', href: '/#aadhaar' },
  { label: 'Features', href: '/#features' },
  { label: 'Developers', href: '/#developers' },
  { label: 'Pricing', href: '/#pricing' },
];

export interface SiteViewer {
  name: string;
  email: string;
}

const menuItem = 'rounded-md px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-2';
const menuLink = `block ${menuItem}`;

/**
 * The top bar of the public pages: the logo, the home page sections, docs and the way in.
 * Someone already signed in gets their dashboard and account menu instead of the sign-in
 * buttons. Below desktop width the links fold into a menu.
 */
export function SiteHeader({
  viewer = null,
  samePage = false,
}: {
  viewer?: SiteViewer | null;
  /** The page carries the home page sections itself, so the links stay on it. */
  samePage?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-white/90 text-ink backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 rounded-md" aria-label="Codevibe Sign home">
          <Wordmark surface="light" className="h-[25px] sm:h-[30px]" />
        </Link>
        <nav aria-label="Site" className="ml-6 hidden items-center gap-0.5 lg:flex">
          <SectionLinks links={SECTIONS} samePage={samePage} />
          <ExternalLink
            href={DOCS_URL}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            Docs
          </ExternalLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {viewer ? (
            <>
              <Button pill asChild size="sm" className="h-9 px-4">
                <Link href={APP_HOME}>Dashboard</Link>
              </Button>
              <UserMenu user={viewer} side="bottom" />
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="hidden rounded-md px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2 sm:inline-flex"
              >
                Sign in
              </Link>
              <Button pill asChild size="sm" className="h-9 px-4">
                <Link href="/sign-in">Start free</Link>
              </Button>
            </>
          )}
          <details className="relative lg:hidden">
            <summary
              aria-label="Menu"
              className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-ink hover:bg-surface-2 [&::-webkit-details-marker]:hidden"
            >
              <Menu aria-hidden className="h-5 w-5" />
            </summary>
            <nav
              aria-label="Site menu"
              className="absolute top-12 right-0 w-64 rounded-xl bg-white p-2 shadow-[0_16px_40px_-12px_rgb(13_27_42/0.3)] ring-1 ring-line"
            >
              {SECTIONS.map((link) => (
                <a
                  key={link.href}
                  href={samePage ? link.href.slice(1) : link.href}
                  className={menuLink}
                >
                  {link.label}
                </a>
              ))}
              <ExternalLink href={DOCS_URL} className={`${menuItem} w-full`}>
                Docs
              </ExternalLink>
              {viewer ? null : (
                <Link
                  href="/sign-in"
                  className={`${menuLink} mt-1 border-t border-line font-semibold`}
                >
                  Sign in
                </Link>
              )}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
