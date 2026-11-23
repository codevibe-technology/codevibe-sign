import { readFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfigWithTheme, type DefaultTheme, type HeadConfig } from 'vitepress';
import { apiSidebar, searchStart } from './api/navigation';
import { externalLinks } from './markdown';
import type { SearchStart } from './theme/search';
import {
  CODEVIBE_URL,
  DOCS_BASE,
  GITHUB_URL,
  OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from './site';

/**
 * The docs are served by the web app under /docs, with clean URLs: `/docs/guides/webhooks`
 * is served from `guides/webhooks.html`, and the app sends `.html` addresses to the clean
 * one. Folder index pages are written out as `getting-started.html` and so on, so every page
 * has one address with no trailing slash.
 */
const BASE = DOCS_BASE;
const DOCS_URL = `${SITE_URL}${BASE}`;

function pageUrl(relativePath: string): string {
  const path = relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
  return withoutTrailingSlash(new URL(path, DOCS_URL).href);
}

/** The app redirects `/docs/` to `/docs`, so links and the sitemap use the address it lands on. */
const withoutTrailingSlash = (url: string) => (url.endsWith('/') ? url.slice(0, -1) : url);

/** Files from the repository served at the site root: the API description and its collection. */
const downloads: Record<string, string> = {
  'openapi.json': fileURLToPath(new URL('../../../packages/server/openapi.json', import.meta.url)),
  'codevibe-sign.postman_collection.json': fileURLToPath(
    new URL('../../../docs/postman/codevibe-sign.postman_collection.json', import.meta.url),
  ),
};

function serveDownloads(): Plugin {
  return {
    name: 'codevibe-downloads',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = downloads[(req.url ?? '').split('?')[0]!.slice(1)];
        if (!file) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file));
      });
    },
  };
}

// `SIGN_SERVER=http://localhost:3000 pnpm --filter site dev` serves a local API under the docs'
// own origin, so the reference can call it without CORS.
const signServer = process.env.SIGN_SERVER;

/** The faces every page sets first, fetched with the page instead of after its CSS. */
const preloadedFonts = ['space-grotesk-latin', 'jetbrains-mono-latin'];

// Which nav tab is lit for a page; every page of the sidebar below falls under exactly one.
const USE_THE_APP = '^/(app/|guides/(verify-pdf|fix-after-sending|field-tags)$)';
const BILLING = '^/(billing/|guides/(pricing|credits-and-billing)$)';
const DEVELOPERS =
  '^/(http-api|api|concepts/|guides/(first-envelope|templates|webhooks|react-signing-view|aadhaar-leegality)$|getting-started$)';
const SELF_HOST = '^/(self-host/|getting-started/)';
const TRUST =
  '^/(security|legal|changelog|contributing|guides/(seal-in-pdf-readers|section-63-certificate))$';

/** One sidebar for every page outside the API reference, grouped by who reads it. */
const docsSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Start here',
    items: [
      { text: 'Start here', link: '/start-here' },
      { text: 'Your account and sign-in', link: '/app/account' },
    ],
  },
  {
    text: 'Use the app',
    items: [
      { text: 'Send a document', link: '/app/send' },
      { text: 'Sign a document', link: '/app/sign' },
      { text: 'Verify a sealed PDF', link: '/guides/verify-pdf' },
      { text: 'Templates in the app', link: '/app/templates' },
      { text: 'Bulk send', link: '/app/bulk-send' },
      { text: 'Fix an envelope after sending', link: '/guides/fix-after-sending' },
      { text: 'Fields across pages and tags', link: '/guides/field-tags' },
    ],
  },
  {
    text: 'Administer a workspace',
    items: [
      { text: 'Team and roles', link: '/admin/team-and-roles' },
      { text: 'Workspaces and addresses', link: '/admin/workspaces' },
      { text: 'Transfer a workspace', link: '/admin/transfer-workspace' },
      { text: 'Brand and white-label', link: '/admin/brand' },
      { text: 'API keys and webhooks', link: '/admin/api-keys-and-webhooks' },
      { text: 'Email log', link: '/admin/email-log' },
      { text: 'Aadhaar eSign settings', link: '/admin/aadhaar-esign' },
    ],
  },
  {
    text: 'Billing and plans',
    items: [
      { text: 'Plans and pricing', link: '/guides/pricing' },
      { text: 'Credits and billing', link: '/guides/credits-and-billing' },
      { text: 'Invoices and credit notes', link: '/billing/invoices' },
      { text: 'Installation help and hosting', link: '/billing/install-help' },
    ],
  },
  {
    text: 'Developers and API',
    items: [
      { text: 'HTTP API', link: '/http-api' },
      { text: 'API quickstart', link: '/http-api/quickstart' },
      { text: 'API reference', link: '/http-api/reference' },
      { text: 'Install the packages', link: '/getting-started' },
      { text: 'Send your first envelope in code', link: '/guides/first-envelope' },
      { text: 'Templates over the API', link: '/guides/templates' },
      { text: 'Webhooks', link: '/guides/webhooks' },
      { text: 'Add the React signing view', link: '/guides/react-signing-view' },
      { text: 'Aadhaar eSign with Leegality', link: '/guides/aadhaar-leegality' },
      {
        text: 'Concepts',
        collapsed: true,
        items: [
          { text: 'Envelopes', link: '/concepts/envelopes' },
          { text: 'Recipients', link: '/concepts/recipients' },
          { text: 'Routing', link: '/concepts/routing' },
          { text: 'Fields and coordinates', link: '/concepts/fields' },
          { text: 'Audit chain', link: '/concepts/audit-chain' },
          { text: 'Sealing and verification', link: '/concepts/sealing' },
          { text: 'OTP and signing links', link: '/concepts/otp-and-links' },
        ],
      },
      {
        text: 'Packages',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/api' },
          { text: 'sign-core', link: '/api/core' },
          { text: 'sign-pdf', link: '/api/pdf' },
          { text: 'sign-server', link: '/api/server' },
          { text: 'sign-react', link: '/api/react' },
          { text: 'sign-aadhaar', link: '/api/aadhaar' },
        ],
      },
    ],
  },
  {
    text: 'Self-host and operate',
    items: [
      { text: 'Self-host with Docker', link: '/getting-started/docker' },
      { text: 'Operate an install', link: '/self-host/operate' },
      { text: 'Embed in Node', link: '/getting-started/node' },
      { text: 'Run a local sandbox', link: '/http-api/sandbox' },
    ],
  },
  {
    text: 'Trust and legal',
    items: [
      { text: 'Security', link: '/security' },
      { text: 'Legal', link: '/legal' },
      { text: 'How the seal works in PDF readers', link: '/guides/seal-in-pdf-readers' },
      { text: 'Electronic evidence (s.63 BSA)', link: '/guides/section-63-certificate' },
      { text: 'Changelog', link: '/changelog' },
      { text: 'Contributing', link: '/contributing' },
    ],
  },
];

export default defineConfigWithTheme<DefaultTheme.Config & { searchStart: SearchStart }>({
  base: BASE,
  lang: 'en',
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  srcExclude: ['README.md', 'public/**'],
  rewrites: {
    'getting-started/index.md': 'getting-started.md',
    'http-api/index.md': 'http-api.md',
    'http-api/reference/index.md': 'http-api/reference.md',
    'api/index.md': 'api.md',
  },
  cleanUrls: true,
  lastUpdated: false,
  // Light until the reader picks dark with the switch; their pick is remembered.
  appearance: { initialValue: 'light' },

  sitemap: {
    hostname: DOCS_URL,
    transformItems: (items) =>
      items.map((item) => ({
        ...item,
        url: withoutTrailingSlash(new URL(item.url, DOCS_URL).href),
      })),
  },

  head: [
    ['link', { rel: 'icon', href: `${BASE}favicon.ico`, sizes: '48x48' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}favicon.svg` }],
    ['link', { rel: 'apple-touch-icon', href: `${BASE}apple-touch-icon.png` }],
    ['link', { rel: 'manifest', href: `${BASE}site.webmanifest` }],
    ['meta', { name: 'theme-color', content: '#0D1B2A' }],
    ...preloadedFonts.map(
      (name): HeadConfig => [
        'link',
        {
          rel: 'preload',
          href: `${BASE}fonts/${name}.woff2`,
          as: 'font',
          type: 'font/woff2',
          crossorigin: '',
        },
      ],
    ),
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:image', content: new URL(OG_IMAGE.slice(1), DOCS_URL).href }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  transformHead({ pageData, title, description }) {
    if (pageData.isNotFound) return [['meta', { name: 'robots', content: 'noindex' }]];
    const url = pageUrl(pageData.relativePath);
    const head: HeadConfig[] = [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
    ];
    return head;
  },

  async buildEnd({ outDir }) {
    for (const [name, file] of Object.entries(downloads)) await copyFile(file, join(outDir, name));
  },

  vite: {
    plugins: [serveDownloads()],
    resolve: {
      alias: [
        // The search box with suggestions before anything is typed; it wraps the stock one.
        {
          find: /^\.\/VPLocalSearchBox\.vue$/,
          replacement: fileURLToPath(new URL('./theme/components/SearchBox.vue', import.meta.url)),
        },
      ],
    },
    ...(signServer
      ? { server: { proxy: { '/v1': signServer, '/health': signServer, '/sign/': signServer } } }
      : {}),
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
    externalLinks: { target: '_blank', rel: 'noopener noreferrer' },
    config: (md) => md.use(externalLinks, { siteHost: new URL(SITE_URL).hostname }),
  },

  themeConfig: {
    logo: { light: '/brand/logo.svg', dark: '/brand/logo-white.svg', alt: SITE_NAME },
    siteTitle: false,

    nav: [
      { text: 'Start here', link: '/start-here', activeMatch: '^/start-here' },
      { text: 'Use the app', link: '/app/send', activeMatch: USE_THE_APP },
      { text: 'Administer', link: '/admin/team-and-roles', activeMatch: '^/admin/' },
      { text: 'Billing', link: '/guides/pricing', activeMatch: BILLING },
      {
        text: 'Developers',
        activeMatch: DEVELOPERS,
        items: [
          { text: 'HTTP API', link: '/http-api' },
          { text: 'API reference', link: '/http-api/reference' },
          { text: 'Packages', link: '/api' },
          { text: 'Concepts', link: '/concepts/envelopes' },
        ],
      },
      { text: 'Self-host', link: '/getting-started/docker', activeMatch: SELF_HOST },
      {
        text: 'Trust',
        activeMatch: TRUST,
        items: [
          { text: 'Security', link: '/security' },
          { text: 'Legal', link: '/legal' },
          { text: 'The seal in PDF readers', link: '/guides/seal-in-pdf-readers' },
          { text: 'Electronic evidence (s.63 BSA)', link: '/guides/section-63-certificate' },
          { text: 'Changelog', link: '/changelog' },
          { text: 'Contributing', link: '/contributing' },
          { text: 'Codevibe', link: CODEVIBE_URL, target: '_blank', rel: 'noopener noreferrer' },
        ],
      },
    ],

    externalLinkIcon: true,

    searchStart: searchStart(),

    sidebar: {
      '/http-api/': apiSidebar(),
      '/': docsSidebar,
    },

    socialLinks: [
      {
        icon: 'github',
        link: GITHUB_URL,
        ariaLabel: 'Codevibe Sign on GitHub (opens in a new tab)',
      },
    ],

    search: { provider: 'local' },

    outline: { level: [2, 3] },

    footer: {
      message:
        'Libraries under Apache-2.0, server and apps under AGPL-3.0. "Codevibe", "Codevibe Sign" and "Hrvibe" are trademarks of Codevibe Technology and are not covered by the licences.',
      copyright: `© 2026 <a href="${CODEVIBE_URL}" target="_blank" rel="noopener noreferrer" class="vp-external-link-icon">Codevibe<span class="cv-sr-only"> (opens in a new tab)</span></a>`,
    },
  },
});
