import { Download, ExternalLink, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { Wordmark } from '@/components/shell/brand-mark';
import { PublicVerifyPanel } from '@/components/verify/public-verify-panel';
import { TRUST_GUIDE } from '@/components/marketing/links';
import { groupFingerprint, installSealCertificate } from '@/server/pdf';
import { isHosted } from '@/server/plans';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify a signed PDF',
  description:
    'Check that a PDF signed with Codevibe Sign is unchanged since it was sealed, and see who signed it and when. No account needed.',
  alternates: { canonical: '/verify' },
  robots: { index: true, follow: true },
};

function seal() {
  try {
    const certificate = installSealCertificate();
    return {
      fingerprint: groupFingerprint(certificate.sha256),
      subject: [certificate.subject.commonName, certificate.subject.organization]
        .filter(Boolean)
        .join(', '),
      notAfter: new Date(certificate.notAfter).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    };
  } catch {
    return null;
  }
}

/** The public page anyone can use to check a sealed PDF, signed in or not. */
export default function PublicVerifyPage() {
  const hosted = isHosted();
  const certificate = seal();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {hosted ? (
        <SiteHeader />
      ) : (
        <header className="border-b border-white/10 bg-header text-header-ink">
          <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
            <Link href="/" className="rounded-md" aria-label="Home">
              <Wordmark />
            </Link>
          </div>
        </header>
      )}
      <main id="main" className="flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <p className="eyebrow mb-2 flex items-center gap-2">
              <span aria-hidden className="h-[2px] w-5 bg-accent" />
              Verify
            </p>
            <h1 className="text-[30px] leading-[1.1] font-bold text-ink sm:text-[38px]">
              Check a signed PDF
            </h1>
            <p className="mt-2 mb-7 max-w-2xl text-[16px] text-muted">
              Drop a PDF you received from Codevibe Sign. You will see whether its seal is intact,
              whether this site made it, who signed and when, and whether the audit trail is
              complete. No account needed.
            </p>
            <PublicVerifyPanel />
          </div>

          <aside className="space-y-5 text-sm">
            <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="eyebrow mb-2">The seal certificate</p>
              {certificate ? (
                <>
                  <p className="text-ink">
                    Files are sealed with{' '}
                    <span className="font-semibold">{certificate.subject || 'this site'}</span>,
                    valid until {certificate.notAfter}.
                  </p>
                  <p className="mt-3 text-muted">SHA-256 fingerprint</p>
                  <code
                    data-testid="seal-fingerprint"
                    className="mt-1 block font-mono text-[12px] leading-5 break-words text-ink"
                  >
                    {certificate.fingerprint}
                  </code>
                  <a
                    href="/verify/certificate"
                    className="mt-4 inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                  >
                    <Download aria-hidden className="h-4 w-4" />
                    Download the certificate (.crt)
                  </a>
                </>
              ) : (
                <p className="text-muted">This site has no seal certificate set up yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="eyebrow mb-2">Adobe says &ldquo;identity unknown&rdquo;?</p>
              <p className="text-ink">
                Adobe Reader trusts only certificates on its own list. Our seal is not on it, so
                Reader can say the signer is unknown even when the file is intact. This page checks
                the same seal. To make Reader show it as trusted, import the certificate.
              </p>
              <a
                href={TRUST_GUIDE}
                className="mt-3 inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
              >
                <ExternalLink aria-hidden className="h-4 w-4" />
                Trust the seal in Adobe
              </a>
            </section>

            <p className="flex gap-2 text-muted">
              <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              Your PDF is checked in memory on this server and dropped straight after. It is not
              saved, and nothing about it is logged.
            </p>
          </aside>
        </div>
      </main>
      {hosted ? <SiteFooter /> : null}
    </div>
  );
}
