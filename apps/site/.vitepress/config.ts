import { readFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig, type HeadConfig } from 'vitepress';
import { CODEVIBE_URL, GITHUB_URL, OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site';

/**
 * The docs are served by the web app under /docs. Folder index pages are written out as
 * `getting-started.html` and so on, so every page has one address with no trailing slash.
 */
const BASE = '/docs/';
const DOCS_URL = `${SITE_URL}${BASE}`;

function pageUrl(relativePath: string): string {
  const path = relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '.html');
  return new URL(path, DOCS_URL).href;
}

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

const fonts =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap';

export default defineConfig({
  base: BASE,
  lang: 'en',
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  srcExclude: ['README.md'],
  rewrites: {
    'getting-started/index.md': 'getting-started.md',
    'http-api/index.md': 'http-api.md',
    'api/index.md': 'api.md',
  },
  cleanUrls: false,
  lastUpdated: false,
  appearance: true,

  sitemap: { hostname: DOCS_URL },

  head: [
    ['link', { rel: 'icon', href: `${BASE}favicon.ico`, sizes: '48x48' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}favicon.svg` }],
    ['link', { rel: 'apple-touch-icon', href: `${BASE}apple-touch-icon.png` }],
    ['link', { rel: 'manifest', href: `${BASE}site.webmanifest` }],
    ['meta', { name: 'theme-color', content: '#0D1B2A' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: fonts }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:image', content: new URL(OG_IMAGE.slice(1), DOCS_URL).href }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  transformHead({ pageData, title, description }) {
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
    ...(signServer
      ? { server: { proxy: { '/v1': signServer, '/health': signServer, '/sign/': signServer } } }
      : {}),
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
  },

  themeConfig: {
    logo: { src: '/mark.svg', alt: '' },
    siteTitle: SITE_NAME,

    nav: [
      { text: 'Get started', link: '/getting-started', activeMatch: '^/getting-started(/|$)' },
      { text: 'Concepts', link: '/concepts/envelopes', activeMatch: '^/concepts/' },
      { text: 'Guides', link: '/guides/first-envelope', activeMatch: '^/guides/' },
      { text: 'HTTP API', link: '/http-api', activeMatch: '^/http-api(/|$)' },
      { text: 'Packages', link: '/api', activeMatch: '^/api(/|$)' },
      {
        text: 'More',
        items: [
          { text: 'Security', link: '/security' },
          { text: 'Legal', link: '/legal' },
          { text: 'Contributing', link: '/contributing' },
          { text: 'Changelog', link: '/changelog' },
          { text: 'Codevibe', link: CODEVIBE_URL },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Install', link: '/getting-started' },
          { text: 'Self-host with Docker', link: '/getting-started/docker' },
          { text: 'Embed in Node', link: '/getting-started/node' },
        ],
      },
      {
        text: 'Concepts',
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
        text: 'Guides',
        items: [
          { text: 'Send your first envelope', link: '/guides/first-envelope' },
          { text: 'Add the React signing view', link: '/guides/react-signing-view' },
          { text: 'Verify a sealed PDF', link: '/guides/verify-pdf' },
          { text: 'Trust the seal in Adobe', link: '/guides/trust-seal-adobe' },
          { text: 'Electronic evidence (s.63 BSA)', link: '/guides/section-63-certificate' },
          { text: 'Aadhaar eSign with Leegality', link: '/guides/aadhaar-leegality' },
          { text: 'Webhooks', link: '/guides/webhooks' },
          { text: 'Fix an envelope after sending', link: '/guides/fix-after-sending' },
          { text: 'Fields across pages and tags', link: '/guides/field-tags' },
        ],
      },
      {
        text: 'HTTP API',
        items: [
          { text: 'Overview', link: '/http-api' },
          { text: 'Interactive reference', link: '/http-api/reference' },
          { text: 'Run a local sandbox', link: '/http-api/sandbox' },
        ],
      },
      {
        text: 'API reference',
        items: [
          { text: 'Overview', link: '/api' },
          { text: 'sign-core', link: '/api/core' },
          { text: 'sign-pdf', link: '/api/pdf' },
          { text: 'sign-server', link: '/api/server' },
          { text: 'sign-react', link: '/api/react' },
          { text: 'sign-aadhaar', link: '/api/aadhaar' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Security', link: '/security' },
          { text: 'Legal', link: '/legal' },
          { text: 'Contributing', link: '/contributing' },
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: GITHUB_URL }],

    search: { provider: 'local' },

    outline: { level: [2, 3] },

    footer: {
      message:
        'Libraries under Apache-2.0, server and apps under AGPL-3.0. "Codevibe", "Codevibe Sign" and "Hrvibe" are trademarks of Codevibe Technology and are not covered by the licences.',
      copyright: `© 2026 <a href="${CODEVIBE_URL}">Codevibe</a>`,
    },
  },
});
