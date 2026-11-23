import { LocalTime } from '@/components/ui/local-time';
import { Download, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { Wordmark } from '@/components/shell/brand-mark';
import { PublicVerifyPanel } from '@/components/verify/public-verify-panel';
import { ExternalLink } from '@/components/marketing/external-link';
import { SEAL_GUIDE } from '@/components/marketing/links';
import { RecordLookup } from '@/components/verify/record-lookup';
import { groupFingerprint, installSealCertificate } from '@/server/pdf';
import { siteViewer } from '@/server/auth/session';
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
      notAfter: new Date(certificate.notAfter).toISOString(),
    };
  } catch {
    return null;
  }
}

/** The public page anyone can use to check a sealed PDF, signed in or not. */
export default async function PublicVerifyPage() {
  const hosted = isHosted();
  const viewer = hosted ? await siteViewer() : null;
  const certificate = seal();
  return (
    <div
      className={
        hosted ? 'marketing flex min-h-dvh flex-col bg-white' : 'flex min-h-dvh flex-col bg-canvas'
      }
    >
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
      <main
        id="main"
        className={`page-enter flex-1 px-4 py-10 sm:px-6 sm:py-14 ${hosted ? 'bg-[linear-gradient(180deg,#F2F7FF_0,#FFFFFF_22rem)]' : ''}`}
      >
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
            <section className="mt-8 rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="eyebrow mb-1">No file at hand?</p>
              <h2 className="mb-3 text-[16px] leading-6 font-semibold text-ink">
                Open the record from the certificate page
              </h2>
              <RecordLookup />
            </section>
          </div>

          <aside className="space-y-5 text-sm">
            <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="eyebrow mb-2">The seal certificate</p>
              {certificate ? (
                <>
                  <p className="text-ink">
                    Files are sealed with{' '}
                    <span className="font-semibold">{certificate.subject || 'this site'}</span>,
                    valid until <LocalTime iso={certificate.notAfter} />.
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

            <p className="flex gap-2 text-muted">
              <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              Your PDF is checked in memory on this server and dropped straight after. It is not
              saved, and nothing about it is logged.
            </p>
            <p>
              <ExternalLink
                href={SEAL_GUIDE}
                className="font-medium text-muted underline hover:text-primary"
              >
                How verification works
              </ExternalLink>
            </p>
          </aside>
        </div>
      </main>
      {hosted ? <SiteFooter /> : null}
    </div>
  );
}
