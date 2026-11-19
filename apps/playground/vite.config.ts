import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

// Point at the package sources so the playground runs without building them first.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@codevibe\/sign-react\/styles\.css$/,
        replacement: fromRoot('packages/react/src/styles.css'),
      },
      { find: /^@codevibe\/sign-react$/, replacement: fromRoot('packages/react/src/index.ts') },
      { find: /^@codevibe\/sign-core$/, replacement: fromRoot('packages/core/src/index.ts') },
    ],
  },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  build: { target: 'es2022' },
});
