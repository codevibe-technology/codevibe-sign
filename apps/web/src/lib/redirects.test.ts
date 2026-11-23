import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_SECTIONS, redirectRules } from './redirects';

describe('redirectRules', () => {
  const rules = redirectRules();
  const target = (source: string) => rules.find((rule) => rule.source === source)?.destination;

  it('sends the old /w app addresses to the dashboard', () => {
    expect(target('/w')).toBe('/dashboard');
    expect(target('/w/:path*')).toBe('/dashboard/:path*');
  });

  it('sends docs links that left out /docs to the docs', () => {
    expect(target('/getting-started/:path*')).toBe('/docs/getting-started/:path*');
    expect(target('/legal')).toBe('/docs/legal');
    expect(target('/http-api')).toBe('/docs/http-api');
  });

  it('sends the renamed seal guide to its new address', () => {
    expect(target('/docs/guides/trust-seal-adobe')).toBe('/docs/guides/seal-in-pdf-readers');
  });

  it('never takes over the app API or an app page', () => {
    expect(rules.some((rule) => rule.source.startsWith('/api'))).toBe(false);
    const appRoutes = readdirSync(join(__dirname, '../app'));
    for (const section of DOCS_SECTIONS) expect(appRoutes).not.toContain(section);
  });

  it('keeps every redirect permanent', () => {
    expect(rules.every((rule) => rule.permanent)).toBe(true);
  });
});
