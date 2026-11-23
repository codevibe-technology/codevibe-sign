#!/usr/bin/env node
// Packs every published package and checks that its types resolve for both ES module and
// CommonJS consumers (`import` and `require`, each with its own declaration file), the way
// TypeScript resolves them under `node16` and `bundler`. Run `pnpm build` first.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const attw = join(root, 'node_modules/.bin/attw');
const out = mkdtempSync(join(tmpdir(), 'cvsign-types-'));
let failed = 0;

try {
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const dir = join(root, 'packages', name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (manifest.private) continue;
    const dest = join(out, name);
    execFileSync('pnpm', ['pack', '--pack-destination', dest], { cwd: dir, stdio: 'pipe' });
    const tarball = join(
      dest,
      readdirSync(dest).find((file) => file.endsWith('.tgz')),
    );
    // Stylesheets are exports too, but they have no types to check.
    const styles = Object.keys(manifest.exports).filter((key) => key.endsWith('.css'));
    try {
      execFileSync(
        attw,
        [
          tarball,
          '--profile',
          'node16',
          '--format',
          'ascii',
          ...(styles.length > 0 ? ['--exclude-entrypoints', ...styles] : []),
        ],
        { cwd: root, stdio: 'pipe' },
      );
      console.log(`  ok  ${manifest.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${manifest.name}\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`${failed} package(s) have types that do not resolve for every consumer`);
  process.exitCode = 1;
}
