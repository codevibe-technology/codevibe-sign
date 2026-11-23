import Link from 'next/link';
import { Wordmark } from '@/components/shell/brand-mark';
import { UserMenu } from '@/components/shell/user-menu';
import { Button } from '@/components/ui/button';
import { APP_HOME } from '@/lib/safe-next';
import { DOCS_URL } from './links';
import { type SectionLink, SectionLinks } from './section-links';

const SECTIONS: SectionLink[] = [
  { label: 'How it works', href: '/#features' },
  { label: 'Developers', href: '/#developers' },
  { label: 'Open source', href: '/#open-source' },
  { label: 'Pricing', href: '/#pricing' },
];

export interface SiteViewer {
  name: string;
  email: string;
}

/**
 * The top bar of the public pages: wordmark, section links, docs and the way in. Someone
 * already signed in gets their dashboard and account menu instead of the sign-in buttons.
 */
export function SiteHeader({ viewer = null }: { viewer?: SiteViewer | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-header/95 text-header-ink backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0 rounded-md" aria-label="Codevibe Sign home">
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="ml-6 hidden items-center gap-1 md:flex">
          <SectionLinks links={SECTIONS} />
          <a
            href={DOCS_URL}
            className="rounded-md px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Docs
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {viewer ? (
            <>
              <Button asChild size="sm">
                <Link href={APP_HOME}>Dashboard</Link>
              </Button>
              <UserMenu user={viewer} side="bottom" />
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="hidden rounded-md px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 sm:inline-flex"
              >
                Sign in
              </Link>
              <Button asChild size="sm">
                <Link href="/sign-in">Start free</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
