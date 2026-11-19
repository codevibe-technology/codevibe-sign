import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { limitsWorkerVitePlugin } from './scripts/limits-worker';

export default defineConfig({
  plugins: [limitsWorkerVitePlugin()],
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
