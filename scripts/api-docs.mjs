#!/usr/bin/env node
// Writes the HTTP API reference pages of the docs site from packages/server/openapi.json, so
// the reference cannot drift from the document. With --check it writes nothing and fails when a
// page is out of date. Run `pnpm openapi` first when openapi.yaml changed.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generatedPages,
  GENERATED_NOTE,
  REFERENCE_DIR,
} from '../apps/site/.vitepress/api/render.ts';

const site = fileURLToPath(new URL('../apps/site/', import.meta.url));
const check = process.argv.includes('--check');
const pages = generatedPages();

const stale = readdirSync(join(site, REFERENCE_DIR))
  .map((name) => `${REFERENCE_DIR}/${name}`)
  .filter((path) => path.endsWith('.md') && !(path in pages))
  .filter((path) => readFileSync(join(site, path), 'utf8').includes(GENERATED_NOTE));

const outdated = Object.entries(pages).filter(([path, content]) => {
  try {
    return readFileSync(join(site, path), 'utf8') !== content;
  } catch {
    return true;
  }
});

if (check) {
  for (const [path] of outdated) console.error(`apps/site/${path} is out of date`);
  for (const path of stale) console.error(`apps/site/${path} is no longer generated`);
  if (outdated.length || stale.length) {
    console.error('Run `pnpm docs:api` to regenerate the API reference.');
    process.exit(1);
  }
  console.log(`${Object.keys(pages).length} API reference pages are up to date`);
} else {
  for (const [path, content] of outdated) {
    mkdirSync(dirname(join(site, path)), { recursive: true });
    writeFileSync(join(site, path), content);
    console.log(`wrote apps/site/${path}`);
  }
  for (const path of stale) {
    rmSync(join(site, path));
    console.log(`removed apps/site/${path}`);
  }
}
