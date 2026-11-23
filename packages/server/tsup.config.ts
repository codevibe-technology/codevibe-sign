import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
  },
  {
    entry: { cli: 'src/cli/main.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
