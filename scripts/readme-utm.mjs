#!/usr/bin/env node
// Tags a package README's links to codevibe.in sites with the right UTM source for where it is
// read. The README in the repository says utm_source=github. npm shows the README from the
// published tarball, so `prepack` switches it to utm_source=npm and `postpack` restores it.
// Run from the package directory:
//
//   node ../../scripts/readme-utm.mjs npm      before packing
//   node ../../scripts/readme-utm.mjs restore  after packing
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const README = 'README.md';
const BACKUP = '.README.md.prepack';
const mode = process.argv[2];

if (mode === 'npm') {
  if (!existsSync(BACKUP)) copyFileSync(README, BACKUP);
  const text = readFileSync(BACKUP, 'utf8').replaceAll('utm_source=github', 'utm_source=npm');
  writeFileSync(README, text);
} else if (mode === 'restore') {
  if (existsSync(BACKUP)) renameSync(BACKUP, README);
} else {
  console.error('usage: node scripts/readme-utm.mjs npm|restore');
  process.exitCode = 2;
}
