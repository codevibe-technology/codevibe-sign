import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveDocsFile, serveDocs } from './docs';

describe('docs files', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cvs-docs-'));
    mkdirSync(join(root, 'guides'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<h1>Docs</h1>');
    writeFileSync(join(root, '404.html'), '<h1>Not found</h1>');
    writeFileSync(join(root, 'getting-started.html'), 'start');
    writeFileSync(join(root, 'guides', 'webhooks.html'), 'hooks');
    writeFileSync(join(root, 'assets', 'app.abc.js'), 'js');
    writeFileSync(join(root, 'openapi.json'), '{}');
    writeFileSync(join(root, 'codevibe-sign-seal.crt'), 'cert');
    writeFileSync(join(root, 'section-63-certificate-template.md'), '# Template');
    vi.stubEnv('DOCS_DIR', root);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('finds pages with or without .html, and the home page', async () => {
    expect(await resolveDocsFile(root, [])).toBe(join(root, 'index.html'));
    expect(await resolveDocsFile(root, ['getting-started'])).toBe(
      join(root, 'getting-started.html'),
    );
    expect(await resolveDocsFile(root, ['guides', 'webhooks'])).toBe(
      join(root, 'guides', 'webhooks.html'),
    );
    expect(await resolveDocsFile(root, ['guides', 'webhooks.html'])).toBe(
      join(root, 'guides', 'webhooks.html'),
    );
    expect(await resolveDocsFile(root, ['guides', 'nope'])).toBeNull();
  });

  it('never leaves the docs folder', async () => {
    expect(await resolveDocsFile(root, ['..', 'etc', 'passwd'])).toBeNull();
    expect(await resolveDocsFile(root, ['guides', '..', '..', 'x'])).toBeNull();
    expect(await resolveDocsFile(root, ['a\0b'])).toBeNull();
  });

  it('serves pages, caches fingerprinted assets and answers 404 with the docs page', async () => {
    const page = await serveDocs(['guides', 'webhooks']);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(await page.text()).toBe('hooks');

    const asset = await serveDocs(['assets', 'app.abc.js']);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');

    expect((await serveDocs(['openapi.json'])).headers.get('content-type')).toContain(
      'application/json',
    );

    expect((await serveDocs(['codevibe-sign-seal.crt'])).headers.get('content-type')).toBe(
      'application/x-x509-ca-cert',
    );
    expect(
      (await serveDocs(['section-63-certificate-template.md'])).headers.get('content-type'),
    ).toBe('text/markdown; charset=utf-8');

    const missing = await serveDocs(['nothing-here']);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('<h1>Not found</h1>');

    const head = await serveDocs([], true);
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('13');
    expect(await head.text()).toBe('');
  });
});
