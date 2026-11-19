import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  defaultPdfEngine,
  listen,
  memoryFileStore,
  memoryStore,
  type RunningSignServer,
  type SignServerOptions,
  type StandaloneConfig,
} from '@codevibe/sign-server';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from './config';
import { run } from './run';

const env: Env = {
  DATABASE_URL: 'postgres://sign:secret@db:5432/sign',
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM: 'Sign <sign@example.com>',
  SEAL_P12_BASE64: Buffer.from([1, 2, 3]).toString('base64'),
  SEAL_P12_PASSPHRASE: 'pass',
  API_KEYS: 'k'.repeat(32),
  PUBLIC_URL: 'http://localhost:3000',
  HOST: '127.0.0.1',
  PORT: '1',
};

/** The PDF engine without its start-up key check, since the test seal key is a placeholder. */
const pdf = {
  inspectPdf: defaultPdfEngine.inspectPdf,
  renderFields: defaultPdfEngine.renderFields,
  appendCertificate: defaultPdfEngine.appendCertificate,
  seal: defaultPdfEngine.seal,
};

/** A stand-in for `startSignServer` that serves the real app on memory adapters. */
function memoryStart() {
  const calls: { config: StandaloneConfig; overrides: Partial<SignServerOptions> }[] = [];
  let address: AddressInfo | undefined;
  const close = vi.fn(async () => undefined);
  const start = async (
    config: StandaloneConfig,
    overrides: Partial<SignServerOptions> = {},
  ): Promise<RunningSignServer> => {
    calls.push({ config, overrides });
    const server = createSignServer({
      store: memoryStore(),
      files: memoryFileStore(),
      mailer: consoleMailer(),
      otp: consoleOtpSender(),
      sealer: config.seal,
      apiKeys: config.apiKeys,
      publicUrl: config.publicUrl,
      pdf,
      ...overrides,
    });
    return {
      server,
      async listen() {
        const http = await listen(server.app, { port: 0, hostname: '127.0.0.1' });
        address = http.address() as AddressInfo;
        close.mockImplementation(
          () => new Promise<undefined>((resolve) => http.close(() => resolve(undefined))),
        );
      },
      close,
    };
  };
  return { start, calls, close, url: () => `http://127.0.0.1:${address?.port}` };
}

function deps(start: ReturnType<typeof memoryStart>['start'], overrides: Env = {}) {
  const signals = new EventEmitter();
  const exit = vi.fn();
  const log = vi.fn();
  const error = vi.fn();
  return { env: { ...env, ...overrides }, start, signals, exit, log, error };
}

describe('run', () => {
  it('passes the parsed config to startSignServer and answers /health', async () => {
    const fake = memoryStart();
    const d = deps(fake.start, { SEAL_REASON: 'Signed', TICK_INTERVAL_SECONDS: '30' });
    await run(d);
    try {
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.config).toMatchObject({
        databaseUrl: env.DATABASE_URL,
        publicUrl: 'http://localhost:3000',
        seal: { reason: 'Signed' },
        tickIntervalMs: 30_000,
      });
      expect(fake.calls[0]?.overrides).toEqual({});
      const res = await fetch(`${fake.url()}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(d.log).toHaveBeenCalledWith('Codevibe Sign listening on 127.0.0.1:1');
    } finally {
      await fake.close();
    }
  });

  it('turns on trustProxy only when asked', async () => {
    const fake = memoryStart();
    const d = deps(fake.start, { TRUST_PROXY: 'true' });
    await run(d);
    expect(fake.calls[0]?.overrides).toEqual({ trustProxy: true, trustedProxyHops: 1 });
    await fake.close();
  });

  it.each(['SIGTERM', 'SIGINT'] as const)('closes once and exits 0 on %s', async (signal) => {
    const fake = memoryStart();
    const d = deps(fake.start);
    await run(d);
    d.signals.emit(signal, signal);
    d.signals.emit(signal, signal);
    await vi.waitFor(() => expect(d.exit).toHaveBeenCalledWith(0));
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(d.exit).toHaveBeenCalledTimes(1);
    await expect(fetch(`${fake.url()}/health`)).rejects.toThrow();
  });

  it('exits 1 when closing fails', async () => {
    const fake = memoryStart();
    const d = deps(fake.start);
    await run(d);
    fake.close.mockRejectedValueOnce(new Error('db busy'));
    d.signals.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(d.exit).toHaveBeenCalledWith(1));
    expect(d.error).toHaveBeenCalledWith('Shutdown failed: db busy');
    await fake.close();
  });

  it('rejects bad configuration before starting anything', async () => {
    const fake = memoryStart();
    await expect(run(deps(fake.start, { DATABASE_URL: undefined }))).rejects.toThrow(
      'DATABASE_URL is required',
    );
    expect(fake.calls).toHaveLength(0);
  });
});
