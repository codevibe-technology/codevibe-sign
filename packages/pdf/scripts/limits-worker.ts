import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

/**
 * `src/limits.ts` imports the parse-limits worker as source text from this module id. Both the
 * package build and the tests resolve it by bundling `src/limits-worker.ts` with pdf-lib into
 * one script, so the published code carries the worker inline and never resolves files at run
 * time.
 */
export const LIMITS_WORKER_ID = 'virtual:limits-worker';

const entry = fileURLToPath(new URL('../src/limits-worker.ts', import.meta.url));

async function bundleLimitsWorker(): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    minify: true,
    legalComments: 'inline',
    write: false,
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error('Bundling the limits worker produced no output.');
  return output.text;
}

async function workerModule(): Promise<string> {
  return `export default ${JSON.stringify(await bundleLimitsWorker())};`;
}

export function limitsWorkerEsbuildPlugin(): Plugin {
  return {
    name: 'limits-worker',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^virtual:limits-worker$/ }, (args) => ({
        path: args.path,
        namespace: 'limits-worker',
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: 'limits-worker' }, async () => ({
        contents: await workerModule(),
        loader: 'js',
      }));
    },
  };
}

export function limitsWorkerVitePlugin() {
  const resolvedId = `\0${LIMITS_WORKER_ID}`;
  return {
    name: 'limits-worker',
    resolveId: (id: string) => (id === LIMITS_WORKER_ID ? resolvedId : undefined),
    load: (id: string) => (id === resolvedId ? workerModule() : undefined),
  };
}
