import { defineConfig } from 'tsup';

// The operator commands of the Docker image (`migrate`, `plan:set`) as self-contained files,
// so the image needs neither tsx nor the source to run them.
export default defineConfig({
  entry: { migrate: 'scripts/migrate.ts', 'plan-set': 'scripts/plan-set.ts' },
  outDir: 'ops',
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  noExternal: [/.*/],
  splitting: false,
  clean: true,
  shims: true,
});
