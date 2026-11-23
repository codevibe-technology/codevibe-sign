import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { byteRange, cleanDocsPath, resolveDocsFile, serveDocs } from './docs';

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
    mkdirSync(join(root, 'clips'));
    writeFileSync(join(root, 'clips', 'send.mp4'), '0123456789');
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

  it('names the clean address of a page asked for by its .html file', () => {
    expect(cleanDocsPath(['guides', 'webhooks.html'])).toBe('/docs/guides/webhooks');
    expect(cleanDocsPath(['getting-started.html'])).toBe('/docs/getting-started');
    expect(cleanDocsPath(['index.html'])).toBe('/docs');
    expect(cleanDocsPath(['guides', 'index.html'])).toBe('/docs/guides');
    expect(cleanDocsPath(['guides', 'webhooks'])).toBeNull();
    expect(cleanDocsPath(['assets', 'app.abc.js'])).toBeNull();
    expect(cleanDocsPath(['404.html'])).toBeNull();
    expect(cleanDocsPath([])).toBeNull();
  });

  it('sends .html addresses of existing pages on to the clean one, keeping the query', async () => {
    const moved = await serveDocs(['guides', 'webhooks.html'], false, '?from=old');
    expect(moved.status).toBe(308);
    expect(moved.headers.get('location')).toBe('/docs/guides/webhooks?from=old');
    expect((await serveDocs(['index.html'])).headers.get('location')).toBe('/docs');
    expect((await serveDocs(['guides', 'nope.html'])).status).toBe(404);
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

  it('serves clips with their video type and the part a range asks for', async () => {
    const whole = await serveDocs(['clips', 'send.mp4']);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');

    const part = await serveDocs(['clips', 'send.mp4'], false, '', 'bytes=2-5');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(part.headers.get('content-length')).toBe('4');
    expect(await part.text()).toBe('2345');

    const past = await serveDocs(['clips', 'send.mp4'], false, '', 'bytes=20-');
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */10');
  });
});

describe('byte ranges', () => {
  it('reads open, closed and suffix ranges', () => {
    expect(byteRange('bytes=0-', 10)).toEqual([0, 9]);
    expect(byteRange('bytes=0-1', 10)).toEqual([0, 1]);
    expect(byteRange('bytes=4-99', 10)).toEqual([4, 9]);
    expect(byteRange('bytes=-3', 10)).toEqual([7, 9]);
  });

  it('sends the whole file for anything it does not handle', () => {
    expect(byteRange(null, 10)).toBeNull();
    expect(byteRange('bytes=-', 10)).toBeNull();
    expect(byteRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(byteRange('items=0-1', 10)).toBeNull();
    expect(byteRange('bytes=5-2', 10)).toBeNull();
  });

  it('refuses a range that starts past the end', () => {
    expect(byteRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', 10)).toBe('unsatisfiable');
  });
});
