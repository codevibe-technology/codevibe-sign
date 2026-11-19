import { defineConfig } from 'tsup';

// Core is only used for types: inline them so the published declarations stand alone.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { resolve: ['@codevibe_technology/sign-core'] },
  clean: true,
});
