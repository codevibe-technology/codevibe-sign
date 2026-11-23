import { defineConfig, type Options } from 'tsup';

type Plugin = NonNullable<Options['esbuildPlugins']>[number];

/**
 * `server-only` throws unless it is resolved with React's `react-server` condition, which
 * Next.js sets for server code. The operator commands are server code run by plain node, so
 * they get an empty module, as that condition would give them.
 */
const serverOnly: Plugin = {
  name: 'server-only',
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({
      path: 'server-only',
      namespace: 'empty',
    }));
    build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
  },
};

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
  esbuildPlugins: [serverOnly],
});
