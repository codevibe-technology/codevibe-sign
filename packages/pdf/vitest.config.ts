import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { fontAssetsVitePlugin } from './scripts/font-assets';
import { limitsWorkerVitePlugin } from './scripts/limits-worker';

export default defineConfig({
  plugins: [limitsWorkerVitePlugin(), fontAssetsVitePlugin()],
  resolve: {
    alias: {
      '@codevibe_technology/sign-core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    testTimeout: 30_000,
  },
});
