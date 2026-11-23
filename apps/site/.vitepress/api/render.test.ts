import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { operations, resources, webhookEvents } from './model.ts';
import { generatedPages, inlineHtml, REFERENCE_DIR } from './render.ts';

const site = fileURLToPath(new URL('../../', import.meta.url));
const pages = generatedPages();

describe('the generated reference', () => {
  it('is up to date with the OpenAPI document', () => {
    for (const [path, content] of Object.entries(pages)) {
      expect(readFileSync(site + path, 'utf8'), `${path}: run pnpm docs:api`).toBe(content);
    }
  });

  it('documents every operation once, under a stable anchor', () => {
    const all = Object.values(pages).join('\n');
    for (const op of operations()) {
      const headings = all.match(new RegExp(`^## .+ \\{#${op.anchor}\\}$`, 'gm')) ?? [];
      expect(headings.length, op.id).toBe(1);
    }
    for (const event of webhookEvents()) {
      expect(pages[`${REFERENCE_DIR}/webhooks.md`]).toContain(`{#${event.anchor}}`);
    }
  });

  it('gives every resource its own page and lists it on the index', () => {
    const index = pages[`${REFERENCE_DIR}/index.md`]!;
    for (const resource of resources()) {
      expect(pages[`${REFERENCE_DIR}/${resource.slug}.md`], resource.name).toBeDefined();
      for (const op of resource.operations) {
        expect(index).toContain(`/docs/${REFERENCE_DIR}/${resource.slug}.html#${op.anchor}`);
      }
    }
  });

  it('lists every error code with its status', () => {
    const errors = pages['http-api/errors.md']!;
    for (const code of ['VALIDATION', 'UNAUTHORIZED', 'RATE_LIMITED', 'PDF_ALREADY_SIGNED']) {
      expect(errors).toMatch(new RegExp(`\`${code}\`</span> \\| \\d{3} `));
    }
  });

  it('marks the Node.js samples for the snippet check', () => {
    const create = pages[`${REFERENCE_DIR}/envelopes.md`]!;
    expect(create).toContain('```ts check [Node.js]');
  });

  it('uses no long dashes', () => {
    for (const [path, content] of Object.entries(pages)) {
      expect(content, path).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('escapes text placed inside HTML and keeps inline code', () => {
    expect(inlineHtml('a <b> `x<y>` & c')).toBe('a &lt;b&gt; <code>x&lt;y&gt;</code> &amp; c');
  });
});
