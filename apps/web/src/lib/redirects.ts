/** The docs pages that sit at the top of the docs site; links without /docs in front still work. */
export const DOCS_SECTIONS = [
  'getting-started',
  'concepts',
  'guides',
  'http-api',
  'legal',
  'security',
  'contributing',
  'changelog',
] as const;

export interface RedirectRule {
  source: string;
  destination: string;
  permanent: boolean;
}

/**
 * Old addresses that still arrive: the app used to live under /w, early links to the docs
 * left out /docs, and one guide was renamed. The package reference stays at /docs/api only: /api is the app's own API.
 */
export function redirectRules(): RedirectRule[] {
  return [
    { source: '/w', destination: '/dashboard', permanent: true },
    { source: '/w/:path*', destination: '/dashboard/:path*', permanent: true },
    {
      source: '/docs/guides/trust-seal-adobe',
      destination: '/docs/guides/seal-in-pdf-readers',
      permanent: true,
    },
    ...DOCS_SECTIONS.flatMap((section) => [
      { source: `/${section}`, destination: `/docs/${section}`, permanent: true },
      { source: `/${section}/:path*`, destination: `/docs/${section}/:path*`, permanent: true },
    ]),
  ];
}
