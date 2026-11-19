import * as signServer from '@codevibe/sign-server';
import { loadConfig, type SignServerConfig } from './config';

/** The shape this entry expects from `@codevibe/sign-server`. See README.md. */
interface RunningServer {
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
}
type CreateSignServer = (config: SignServerConfig) => RunningServer | Promise<RunningServer>;

function resolveFactory(): CreateSignServer {
  const factory = (signServer as unknown as { createSignServer?: unknown }).createSignServer;
  if (typeof factory !== 'function') {
    throw new Error('This build of @codevibe/sign-server does not export createSignServer');
  }
  return factory as CreateSignServer;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = await resolveFactory()(config.server);
  await server.listen(config.port, config.host);
  console.log(`Codevibe Sign listening on ${config.host}:${config.port}`);

  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, closing`);
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('Shutdown failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  // Only the message: configuration errors name variables, never their values.
  console.error(error instanceof Error ? error.message : 'Failed to start');
  process.exit(1);
});
