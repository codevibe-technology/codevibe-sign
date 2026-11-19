import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['pdfjs-dist'],
  async onSuccess() {
    await copyFile('src/styles.css', 'dist/styles.css');
  },
});
