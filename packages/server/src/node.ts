import { serve, type ServerType } from '@hono/node-server';
import type { Hono } from 'hono';
import { localFileStore } from './adapters/files';
import { mailOtpSender, smtpMailer } from './adapters/mail';
import type { SignServerOptions } from './options';
import { createSignServer, type SignServer } from './server';
import { migrate, postgresStore } from './store/postgres';

export interface ListenOptions {
  port: number;
  hostname?: string;
}

/** Serves a Hono app with Node's HTTP server and resolves once it is listening. */
export function listen(app: Hono, options: ListenOptions): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: options.port, hostname: options.hostname }, () =>
      resolve(server),
    );
    server.once('error', reject);
  });
}

export interface StandaloneConfig {
  databaseUrl: string;
  filesDir: string;
  smtp: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };
  seal: { p12: Uint8Array; passphrase: string; reason?: string; location?: string };
  apiKeys: string[];
  publicUrl: string;
  /** How often reminders, expiry and retries run. Default 60 seconds. */
  tickIntervalMs?: number;
}

export interface RunningSignServer {
  server: SignServer;
  listen(port: number, host?: string): Promise<void>;
  /** Stops accepting requests, lets in-flight requests and jobs finish, then disconnects. */
  close(): Promise<void>;
}

/**
 * The standalone service: PostgreSQL, files on disk, SMTP email and email OTP. Migrates
 * the database, then runs `tick()` on a timer once listening. `overrides` replaces any
 * of the built adapters or options.
 */
export async function startSignServer(
  config: StandaloneConfig,
  overrides: Partial<SignServerOptions> = {},
): Promise<RunningSignServer> {
  const store = postgresStore(config.databaseUrl);
  await migrate(store.sql);
  const mailer = smtpMailer({
    transport: {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      ...(config.smtp.user
        ? { auth: { user: config.smtp.user, pass: config.smtp.pass ?? '' } }
        : {}),
    },
    from: config.smtp.from,
  });
  const server = createSignServer({
    store,
    files: localFileStore(config.filesDir),
    mailer,
    otp: mailOtpSender(mailer),
    sealer: config.seal,
    apiKeys: config.apiKeys,
    publicUrl: config.publicUrl,
    effects: 'background',
    ...overrides,
  });

  let http: ServerType | undefined;
  let timer: NodeJS.Timeout | undefined;
  let ticking: Promise<unknown> = Promise.resolve();

  return {
    server,
    async listen(port, host) {
      http = await listen(server.app, { port, ...(host ? { hostname: host } : {}) });
      timer = setInterval(() => {
        ticking = ticking.then(() =>
          server.tick().catch((err: unknown) => {
            console.error('tick failed:', err instanceof Error ? err.message : err);
          }),
        );
      }, config.tickIntervalMs ?? 60_000);
      timer.unref();
    },
    async close() {
      if (timer) clearInterval(timer);
      if (http) {
        const closing = http;
        await new Promise<void>((resolve, reject) =>
          closing.close((err) => (err ? reject(err) : resolve())),
        );
      }
      await ticking;
      await server.idle();
      mailer.close();
      await store.sql.end({ timeout: 5 });
    },
  };
}
