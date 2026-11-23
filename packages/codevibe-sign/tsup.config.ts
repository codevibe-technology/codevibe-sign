import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { defineConfig } from 'tsup';

const require = createRequire(import.meta.url);

// One build per entry, so each declaration file only references the package it re-exports.
const libraries = ['index', 'client', 'pdf', 'core'].map((name) => ({
  entry: { [name]: `src/${name}.ts` },
  format: ['esm' as const, 'cjs' as const],
  dts: true,
}));

export default defineConfig([
  ...libraries,
  {
    // The React components are bundled in, so `react` stays an optional peer and installs that
    // never render a page do not pull it in.
    entry: { react: 'src/react.ts' },
    format: ['esm', 'cjs'],
    dts: { resolve: ['@codevibe_technology/sign-react'] },
    noExternal: ['@codevibe_technology/sign-react'],
    external: ['react', 'react-dom', 'react/jsx-runtime', 'pdfjs-dist'],
    async onSuccess() {
      await mkdir('dist/react', { recursive: true });
      await copyFile(
        require.resolve('@codevibe_technology/sign-react/styles.css'),
        'dist/react/styles.css',
      );
    },
  },
  {
    entry: { cli: 'src/cli/main.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
