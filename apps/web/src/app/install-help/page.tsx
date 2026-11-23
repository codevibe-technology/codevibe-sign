import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ExternalLink } from '@/components/marketing/external-link';
import { InstallHelpForm } from '@/components/marketing/install-help-form';
import { SELF_HOST_DOCS } from '@/components/marketing/links';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { INSTALL_HELP_HOURS } from '@/lib/billing/install-help';
import { siteViewer } from '@/server/auth/session';
import { currentPricing } from '@/server/billing/pricing';
import { turnstileSiteKey } from '@/server/human-check';
import { isHosted } from '@/server/plans';

export const metadata: Metadata = {
  title: 'Installation help',
  description:
    'An experienced engineer installs Codevibe Sign on your own server within four working hours.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/install-help' },
};

const INCLUDED = [
  'Codevibe Sign installed on your server with Docker, behind HTTPS on your domain',
  'The database, file storage and a daily backup set up',
  'Email sending connected to the mailbox you choose',
  'A seal certificate created, and the first workspace ready to sign in to',
  'A short handover: how to upgrade, back up and restore',
];

/** The paid installation service for people who self-host, with its booking form. */
export default async function InstallHelpPage() {
  if (!isHosted()) notFound();
  const pricing = currentPricing();
  return (
    <div className="marketing flex min-h-dvh flex-col bg-white">
      <SiteHeader viewer={await siteViewer()} />
      <main
        id="main"
        className="page-enter flex-1 bg-[linear-gradient(180deg,#F2F7FF_0,#FFFFFF_22rem)] px-4 py-12 sm:px-6 sm:py-16"
      >
        <div className="mx-auto grid max-w-6xl gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div>
            <p className="inline-flex rounded-full bg-[#DDF7F2] px-3 py-1 text-[13px] font-semibold text-[#0E7466]">
              Self-hosting
            </p>
            <h1 className="mt-4 text-3xl font-bold sm:text-[2.6rem] sm:leading-[1.1]">
              We install it on your server.
            </h1>
            <p className="mt-4 text-lg text-muted">
              Codevibe Sign is free to run on your own server. If you would rather not set it up
              yourself, an experienced engineer does it for you within {INSTALL_HELP_HOURS} working
              hours of getting access.
            </p>
            <p className="mt-6">
              <span className="font-display text-4xl font-bold tracking-tight">
                {pricing.installHelp}
              </span>
              <span className="ml-2 text-muted">once, plus {pricing.gstPercent}% GST</span>
            </p>
            <ul className="mt-8 space-y-3 border-t border-line pt-6">
              {INCLUDED.map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-success" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-muted">
              You need a server with Docker and a domain name. Prefer to do it yourself? The{' '}
              <ExternalLink
                className="font-semibold text-primary hover:underline"
                href={SELF_HOST_DOCS}
              >
                self-hosting guide
              </ExternalLink>{' '}
              covers every step.
            </p>

            {pricing.hostingOffers.length > 0 ? (
              <section aria-labelledby="server-title" className="mt-10 border-t border-line pt-8">
                <h2 id="server-title" className="text-xl font-semibold">
                  Need a server?
                </h2>
                <p className="mt-2 text-muted">
                  These hosts work well for Codevibe Sign, at 20% off through our partner links.
                </p>
                <ul className="mt-4 divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
                  {pricing.hostingOffers.map((offer) => (
                    <li
                      key={offer.url}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div>
                        <p className="font-semibold">{offer.name}</p>
                        {offer.note ? <p className="text-sm text-muted">{offer.note}</p> : null}
                      </div>
                      <ExternalLink
                        className="font-semibold text-primary hover:underline"
                        href={offer.url}
                      >
                        See the offer
                      </ExternalLink>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="self-start rounded-2xl bg-white p-6 shadow-[0_28px_56px_-28px_rgb(27_106_224/0.45)] ring-1 ring-line sm:p-8">
            <h2 className="text-2xl font-bold">Book an installation</h2>
            {pricing.paymentsOpen ? (
              <>
                <p className="mt-2 mb-8 text-muted">
                  Pay online and get a GST tax invoice by email. We then write to you to arrange
                  access and the time.
                </p>
                <InstallHelpForm
                  price={pricing.installHelp}
                  gstPercent={pricing.gstPercent}
                  testMode={pricing.testMode}
                  humanCheckKey={turnstileSiteKey()}
                />
              </>
            ) : (
              <div className="mt-4 space-y-3 text-muted" data-testid="booking-closed">
                <p className="text-lg font-semibold text-ink">Booking opens soon.</p>
                <p>
                  Online booking and payment are being set up.
                  {pricing.operatorEmail ? ' Until then, write to us and we will arrange it.' : ''}
                </p>
                {pricing.operatorEmail ? (
                  <a
                    className="inline-flex h-11 items-center rounded-full bg-primary px-5 font-semibold text-primary-ink hover:bg-primary-hover"
                    href={`mailto:${pricing.operatorEmail}?subject=${encodeURIComponent('Codevibe Sign installation help')}`}
                  >
                    Write to {pricing.operatorEmail}
                  </a>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
