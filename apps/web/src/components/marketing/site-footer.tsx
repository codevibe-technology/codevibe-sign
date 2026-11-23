import Link from 'next/link';
import { Wordmark } from '@/components/shell/brand-mark';
import { ExternalLink } from './external-link';
import { CODEVIBE_URL, CONTACT_EMAIL, DOCS_URL, GITHUB_URL, VERIFY_URL } from './links';

const LINKS = [
  { label: 'Docs', href: DOCS_URL },
  { label: 'Verify a PDF', href: VERIFY_URL },
  { label: 'GitHub', href: GITHUB_URL, external: true },
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Codevibe', href: CODEVIBE_URL, external: true },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-header text-header-ink">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Wordmark surface="dark" />
          <p className="mt-3 text-sm text-white/70">
            Open-source e-signatures, made in India by Codevibe, a software agency. Questions:{' '}
            <a
              className="font-semibold text-white hover:underline"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {LINKS.map((link) => (
              <li key={link.label}>
                {link.external ? (
                  <ExternalLink
                    href={link.href}
                    className="font-medium text-white/80 hover:text-white hover:underline"
                  >
                    {link.label}
                  </ExternalLink>
                ) : link.href.startsWith('/docs') ? (
                  <a
                    href={link.href}
                    className="font-medium text-white/80 hover:text-white hover:underline"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    href={link.href}
                    className="font-medium text-white/80 hover:text-white hover:underline"
                  >
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/60 sm:px-6">
          © 2026 Codevibe Technology. Libraries under Apache-2.0, server and app under AGPL-3.0.
          &ldquo;Codevibe&rdquo; and &ldquo;Codevibe Sign&rdquo; are trademarks of Codevibe
          Technology.
        </p>
      </div>
    </footer>
  );
}
