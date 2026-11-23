import { defineConfig } from 'tsup';
import { fontAssetsEsbuildPlugin } from './scripts/font-assets';
import { limitsWorkerEsbuildPlugin } from './scripts/limits-worker';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  shims: true,
  esbuildPlugins: [limitsWorkerEsbuildPlugin(), fontAssetsEsbuildPlugin()],
});
