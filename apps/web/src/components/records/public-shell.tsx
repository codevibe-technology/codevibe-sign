import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { Wordmark } from '@/components/shell/brand-mark';
import { siteViewer } from '@/server/auth/session';
import { isHosted } from '@/server/plans';

/** The frame of a public record page: the site's header on the cloud, a plain one elsewhere. */
export async function PublicShell({ children }: { children: ReactNode }) {
  const hosted = isHosted();
  const viewer = hosted ? await siteViewer() : null;
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {hosted ? (
        <SiteHeader viewer={viewer} />
      ) : (
        <header className="border-b border-line bg-surface text-ink">
          <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
            <Link href="/" className="rounded-md" aria-label="Home">
              <Wordmark surface="theme" />
            </Link>
          </div>
        </header>
      )}
      <main id="main" className="page-enter flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
      {hosted ? <SiteFooter /> : null}
    </div>
  );
}
