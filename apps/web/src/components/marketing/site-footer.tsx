import Link from 'next/link';
import { Wordmark } from '@/components/shell/brand-mark';
import { ExternalLink } from './external-link';
import {
  AADHAAR_GUIDE,
  API_DOCS,
  CODEVIBE_URL,
  CONTACT_EMAIL,
  DOCS_URL,
  GITHUB_URL,
  SECURITY_DOCS,
  SELF_HOST_DOCS,
  VERIFY_URL,
} from './links';

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'Aadhaar eSign', href: '/#aadhaar' },
      { label: 'Pricing', href: '/#pricing' },
      { label: 'Verify a PDF', href: VERIFY_URL },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Docs', href: DOCS_URL },
      { label: 'HTTP API', href: API_DOCS },
      { label: 'Self-hosting guide', href: SELF_HOST_DOCS },
      { label: 'GitHub', href: GITHUB_URL, external: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Installation help', href: '/install-help' },
      { label: 'Aadhaar eSign guide', href: AADHAAR_GUIDE },
      { label: 'Security', href: SECURITY_DOCS },
      { label: 'Codevibe', href: CODEVIBE_URL, external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
    ],
  },
];

const linkClass = 'text-sm text-white/75 hover:text-white hover:underline';

function FooterAnchor({ link }: { link: FooterLink }) {
  // The docs are a separate static site, so they open in a tab of their own, like other sites.
  if (link.external || link.href.startsWith('/docs')) {
    return (
      <ExternalLink href={link.href} className={linkClass}>
        {link.label}
      </ExternalLink>
    );
  }
  // Section links load the home page: plain links.
  if (link.href.startsWith('/#')) {
    return (
      <a href={link.href} className={linkClass}>
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={linkClass}>
      {link.label}
    </Link>
  );
}

/** The navy footer of the public pages: the logo and contact, four columns of links, the legal line. */
export function SiteFooter() {
  return (
    <footer className="bg-[#0D1B2A] text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 pt-16 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,3fr)] lg:px-8">
        <div className="max-w-sm">
          <Wordmark surface="dark" className="h-[28px]" />
          <p className="mt-4 text-sm leading-6 text-white/75">
            E-signatures with proof built in, and Aadhaar eSign when a law asks for it. Open source,
            made in India by Codevibe Technology.
          </p>
          <p className="mt-4 text-sm">
            <a
              className="font-semibold text-white underline-offset-2 hover:underline"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="font-display text-sm font-semibold tracking-normal text-white">
                {column.title}
              </h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterAnchor link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-6 text-xs leading-5 text-white/65 sm:px-6 lg:px-8">
          © 2026 Codevibe Technology. Libraries under Apache-2.0, server and app under AGPL-3.0.
          &ldquo;Codevibe&rdquo; and &ldquo;Codevibe Sign&rdquo; are trademarks of Codevibe
          Technology. Aadhaar eSign runs through Leegality, an eSign application service provider.
        </p>
      </div>
    </footer>
  );
}
