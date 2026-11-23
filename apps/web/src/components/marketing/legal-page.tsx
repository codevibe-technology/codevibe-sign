import type { ReactNode } from 'react';
import { SiteFooter } from './site-footer';
import { SiteHeader, type SiteViewer } from './site-header';

/** A plain reading page for the terms and the privacy notice. */
export function LegalPage({
  title,
  updated,
  intro,
  viewer = null,
  children,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  viewer?: SiteViewer | null;
  children: ReactNode;
}) {
  return (
    <div className="marketing flex min-h-dvh flex-col bg-white">
      <SiteHeader viewer={viewer} />
      <main
        id="main"
        className="page-enter flex-1 bg-[linear-gradient(180deg,#F2F7FF_0,#FFFFFF_22rem)] px-4 py-12 sm:px-6 sm:py-16"
      >
        <article className="mx-auto max-w-2xl">
          <p className="inline-flex rounded-full bg-[#E6EFFC] px-3 py-1 text-[13px] font-semibold text-[#1860D0]">
            Codevibe Sign cloud
          </p>
          <h1 className="mt-4 text-3xl font-bold sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
          <div className="mt-6 text-lg text-ink">{intro}</div>
          <div className="mt-8 space-y-8">{children}</div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 leading-7 text-ink [&_a]:font-semibold [&_a]:text-primary [&_a:hover]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}
