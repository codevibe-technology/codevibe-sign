import { startSignServer } from '@codevibe/sign-server';
import { loadConfig, type Env } from './config';

type Start = typeof startSignServer;

export interface RunDeps {
  env: Env;
  start?: Start;
  /** Where SIGTERM and SIGINT handlers are registered; `process` in production. */
  signals: { once(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown };
  log?: (message: string) => void;
  error?: (message: string) => void;
  exit: (code: number) => void;
}

/**
 * Starts the service from the environment and closes it cleanly on SIGTERM or SIGINT.
 * Resolves once the server is listening.
 */
export async function run(deps: RunDeps): Promise<void> {
  const { env, start = startSignServer, signals, exit } = deps;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;

  const config = loadConfig(env);
  const running = await start(
    config.server,
    config.trustProxy ? { trustProxy: true, trustedProxyHops: config.trustedProxyHops } : {},
  );
  await running.listen(config.port, config.host);
  log(`Codevibe Sign listening on ${config.host}:${config.port}`);

  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    log(`${signal} received, closing`);
    running.close().then(
      () => exit(0),
      (err: unknown) => {
        error(`Shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
        exit(1);
      },
    );
  };
  signals.once('SIGTERM', shutdown);
  signals.once('SIGINT', shutdown);
}
