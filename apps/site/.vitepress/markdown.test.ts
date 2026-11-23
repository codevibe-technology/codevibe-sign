import { createMarkdownRenderer } from 'vitepress';
import { describe, expect, it } from 'vitest';
import { externalLinks } from './markdown.ts';

describe('external links in markdown', async () => {
  const md = await createMarkdownRenderer(process.cwd(), {
    externalLinks: { target: '_blank', rel: 'noopener noreferrer' },
    config: (renderer) => renderer.use(externalLinks, { siteHost: 'sign.codevibe.in' }),
  });

  it('open other sites in a new tab and say so to screen readers', () => {
    const html = md.render('[GitHub](https://github.com/codevibe-technology)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<span class="cv-sr-only"> (opens in a new tab)</span></a>');
  });

  it('leave links inside the docs and to the site itself alone', () => {
    expect(md.render('[Quickstart](/http-api/quickstart)')).not.toContain('cv-sr-only');
    expect(md.render('[Home](https://sign.codevibe.in/)')).not.toContain('cv-sr-only');
  });
});
