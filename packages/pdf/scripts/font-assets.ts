import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import type { Plugin } from 'esbuild';

/**
 * `src/harfbuzz.ts` and `src/script-fonts.ts` import the HarfBuzz shaper and subsetter and the fallback fonts from this module id. Both
 * the package build and the tests resolve it to brotli-compressed base64 strings, so the
 * published code carries them inline and never resolves files at run time (bundlers such as
 * Next.js move the code away from its package folder).
 */
export const FONT_ASSETS_ID = 'virtual:font-assets';

const fontsDir = fileURLToPath(new URL('../fonts/', import.meta.url));
const require = createRequire(import.meta.url);

function pack(bytes: Buffer): string {
  return brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  }).toString('base64');
}

async function assetsModule(): Promise<string> {
  const wasm = await readFile(require.resolve('harfbuzzjs/dist/harfbuzz.wasm'));
  const subsetWasm = await readFile(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'));
  const files = (await readdir(fontsDir)).filter((file) => file.endsWith('.ttf')).sort();
  const fonts: Record<string, string> = {};
  for (const file of files) {
    fonts[file.replace(/\.ttf$/, '')] = pack(await readFile(fontsDir + file));
  }
  return [
    `export const harfbuzz = ${JSON.stringify(pack(wasm))};`,
    `export const harfbuzzSubset = ${JSON.stringify(pack(subsetWasm))};`,
    `export const fonts = ${JSON.stringify(fonts)};`,
  ].join('\n');
}

let cached: Promise<string> | undefined;
const load = () => (cached ??= assetsModule());

export function fontAssetsEsbuildPlugin(): Plugin {
  return {
    name: 'font-assets',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^virtual:font-assets$/ }, (args) => ({
        path: args.path,
        namespace: 'font-assets',
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: 'font-assets' }, async () => ({
        contents: await load(),
        loader: 'js',
      }));
    },
  };
}

export function fontAssetsVitePlugin() {
  const resolvedId = `\0${FONT_ASSETS_ID}`;
  return {
    name: 'font-assets',
    resolveId: (id: string) => (id === FONT_ASSETS_ID ? resolvedId : undefined),
    load: (id: string) => (id === resolvedId ? load() : undefined),
  };
}
