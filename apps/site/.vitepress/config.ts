import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig, type HeadConfig } from 'vitepress';
import { CODEVIBE_URL, GITHUB_URL, OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site';

function pageUrl(relativePath: string): string {
  const path = relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '.html');
  return new URL(path, `${SITE_URL}/`).href;
}

const fonts =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap';

export default defineConfig({
  lang: 'en',
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  srcExclude: ['README.md'],
  cleanUrls: false,
  lastUpdated: false,
  appearance: true,

  sitemap: { hostname: SITE_URL },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#0D1B2A' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: fonts }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:image', content: new URL(OG_IMAGE, SITE_URL).href }],
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
    const robots = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', SITE_URL).href}\n`;
    await writeFile(join(outDir, 'robots.txt'), robots);
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
  },

  themeConfig: {
    logo: { src: '/mark.svg', alt: '' },
    siteTitle: SITE_NAME,

    nav: [
      { text: 'Get started', link: '/getting-started/', activeMatch: '^/getting-started/' },
      { text: 'Concepts', link: '/concepts/envelopes', activeMatch: '^/concepts/' },
      { text: 'Guides', link: '/guides/first-envelope', activeMatch: '^/guides/' },
      { text: 'API', link: '/api/', activeMatch: '^/api/' },
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
          { text: 'Install', link: '/getting-started/' },
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
          { text: 'Aadhaar eSign with Leegality', link: '/guides/aadhaar-leegality' },
          { text: 'Webhooks', link: '/guides/webhooks' },
        ],
      },
      {
        text: 'API reference',
        items: [
          { text: 'Overview', link: '/api/' },
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
        'Code released under the Apache License 2.0. "Codevibe", "Codevibe Sign" and "Hrvibe" are trademarks of Codevibe Technology and are not covered by the licence.',
      copyright: `© 2026 <a href="${CODEVIBE_URL}">Codevibe</a>`,
    },
  },
});
