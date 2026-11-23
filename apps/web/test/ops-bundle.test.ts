import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import config from '../tsup.ops.config';

const app = fileURLToPath(new URL('..', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'sign-ops-'));

/** Runs a built operator command with plain node, the way the Docker image does. */
function run(file: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [join(out, file), ...args], {
    cwd: out,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production' },
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('the operator commands bundled for the Docker image', () => {
  beforeAll(async () => {
    const options = Array.isArray(config) ? config[0] : config;
    if (!options || typeof options === 'function') throw new Error('Expected one tsup config');
    const entry = options.entry as Record<string, string>;
    await build({
      ...options,
      entry: Object.fromEntries(
        Object.entries(entry).map(([name, path]) => [name, join(app, path)]),
      ),
      outDir: out,
      silent: true,
    });
  }, 120_000);

  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('runs plan-set under plain node and prints its usage without arguments', () => {
    const { status, output } = run('plan-set.mjs');
    expect(status).toBe(1);
    expect(output).toContain('Usage:');
    expect(output).not.toContain('Client Component');
  });

  it('runs migrate under plain node and asks for the database', () => {
    const { status, output } = run('migrate.mjs');
    expect(status).toBe(1);
    expect(output).toContain('Set DATABASE_URL');
    expect(output).not.toContain('Client Component');
  });
});
