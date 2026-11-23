import { randomBytes } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { SignError } from '@codevibe_technology/sign-core';
import { createDevSeal, sealCertificate } from '@codevibe_technology/sign-pdf';
import { consoleMailer, consoleOtpSender } from '../adapters/mail';
import { memoryFileStore } from '../adapters/files';
import { configFromEnv, type EnvVars } from '../env';
import { listen, startSignServer } from '../node';
import type { SealerOptions } from '../options';
import { createSignServer } from '../server';
import { memoryStore } from '../store/memory';
import { VERSION } from './version';
import { EXIT, painter, parse, readInput, rows, UsageError, type Command, type Io } from './io';

/** Resolves on SIGINT or SIGTERM; tests can pass their own. */
export type StopSignal = () => Promise<NodeJS.Signals>;

const processSignal: StopSignal = () =>
  new Promise((resolve) => {
    const stop = (signal: NodeJS.Signals) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve(signal);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

const FLAGS = {
  memory: { type: 'boolean' },
  port: { type: 'string', short: 'p' },
  host: { type: 'string' },
  'public-url': { type: 'string' },
  'database-url': { type: 'string' },
  'files-dir': { type: 'string' },
  seal: { type: 'string' },
} as const;

type Values = ReturnType<typeof parse<typeof FLAGS>>['values'];

/** Flags win over variables; `--seal` reads the file into SEAL_P12_BASE64. */
async function envFrom(values: Values, env: EnvVars): Promise<EnvVars> {
  const merged: EnvVars = { ...env };
  const set = (name: string, value: string | undefined) => {
    if (value !== undefined) merged[name] = value;
  };
  set('PORT', values.port);
  set('HOST', values.host);
  set('PUBLIC_URL', values['public-url']);
  set('DATABASE_URL', values['database-url']);
  set('FILES_DIR', values['files-dir']);
  if (values.seal) {
    merged.SEAL_P12_BASE64 = Buffer.from(await readInput(values.seal)).toString('base64');
  }
  return merged;
}

function healthUrl(host: string, port: number): string {
  const local = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${local.includes(':') ? `[${local}]` : local}:${port}/health`;
}

function sealLine(sealer: { p12: Uint8Array; passphrase: string; allowWeakKey?: boolean }): string {
  const certificate = sealCertificate(sealer);
  const name = certificate.subject.commonName ?? certificate.subject.organization ?? 'unnamed';
  return `${name}, sha256 ${certificate.sha256.slice(0, 16)}...`;
}

/** Port 0 asks for any free port; it is resolved first so signing links carry the real one. */
function freePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function portOf(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError('--port (PORT) must be a whole number from 0 to 65535.');
  }
  return port;
}

async function startMemory(env: EnvVars, io: Io, stop: StopSignal): Promise<number> {
  const paint = painter(io.color);
  const port = portOf(env.PORT, 3000);
  const host = env.HOST?.trim() || '127.0.0.1';

  let sealer: SealerOptions;
  let sealNote: string;
  if (env.SEAL_P12_BASE64?.trim()) {
    sealer = {
      p12: new Uint8Array(Buffer.from(env.SEAL_P12_BASE64, 'base64')),
      passphrase: env.SEAL_P12_PASSPHRASE ?? '',
    };
    sealNote = sealLine(sealer);
  } else {
    const dev = createDevSeal({ days: 30 });
    sealer = { p12: dev.p12, passphrase: dev.passphrase };
    sealNote = `generated, self-signed, sha256 ${dev.sha256.slice(0, 16)}...`;
  }
  const keys = (env.API_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const generatedKey = keys.length === 0 ? randomBytes(32).toString('base64url') : undefined;
  if (generatedKey) keys.push(generatedKey);

  const actual = port === 0 ? await freePort(host) : port;
  const publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, '') || `http://localhost:${actual}`;
  const server = createSignServer({
    store: memoryStore(),
    files: memoryFileStore(),
    mailer: consoleMailer(),
    otp: consoleOtpSender(),
    sealer,
    apiKeys: keys,
    publicUrl,
  });
  const http = await listen(server.app, { port: actual, hostname: host });
  const timer = setInterval(() => void server.tick().catch(() => undefined), 15_000);
  timer.unref();

  const loopback = ['127.0.0.1', '0.0.0.0', '::1', '::', 'localhost'].includes(host);
  const base = loopback
    ? `http://localhost:${actual}`
    : `http://${host.includes(':') ? `[${host}]` : host}:${actual}`;
  io.out(
    `${paint('bold', `Codevibe Sign ${VERSION}`)} ${paint('yellow', '(memory mode: nothing is saved, for local development only)')}\n\n` +
      rows([
        ['API', base],
        ['Health', `${base}/health`],
        ['Signing links', `${publicUrl}/sign/...`],
        ['API key', generatedKey ?? `${keys.length} from API_KEYS`],
        ['Seal', sealNote],
        ['Email and codes', 'printed here instead of sent'],
      ]) +
      `\n\nSend a PDF for signature:\n` +
      `  curl -s ${base}/v1/envelopes \\\n` +
      `    -H "Authorization: Bearer ${generatedKey ?? '$SIGN_API_KEY'}" \\\n` +
      `    -H "Content-Type: application/json" \\\n` +
      `    -d '{"title":"Offer letter","send":true,` +
      `"documents":[{"key":"doc","name":"offer.pdf","content":"'"$(base64 < offer.pdf | tr -d '\\n')"'"}],` +
      `"recipients":[{"key":"asha","name":"Asha Rao","email":"asha@example.com"}],` +
      `"fields":[{"recipient":"asha","type":"signature","page":0,"x":72,"y":640,"width":180,"height":48}]}'\n\n` +
      `Press Ctrl+C to stop.`,
  );

  const signal = await stop();
  io.out(`\n${signal} received, closing`);
  clearInterval(timer);
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await server.idle();
  return EXIT.ok;
}

async function startStandalone(env: EnvVars, io: Io, stop: StopSignal): Promise<number> {
  const paint = painter(io.color);
  let config;
  try {
    config = configFromEnv({ FILES_DIR: './data/files', ...env });
  } catch (error) {
    if (error instanceof SignError && error.code === 'VALIDATION') {
      io.err(
        `${error.message}\n\nSet them as environment variables or flags (codevibe-sign-server start --help).\n` +
          `To try it without any setup: codevibe-sign-server start --memory`,
      );
      return EXIT.usage;
    }
    throw error;
  }
  const sealNote = sealLine(config.server.seal);
  const running = await startSignServer(
    config.server,
    config.trustProxy ? { trustProxy: true, trustedProxyHops: config.trustedProxyHops } : {},
  );
  await running.listen(config.port, config.host);
  io.out(
    `${paint('bold', `Codevibe Sign ${VERSION}`)} listening on ${config.host}:${config.port}\n\n` +
      rows([
        ['Public URL', config.server.publicUrl],
        ['Health', healthUrl(config.host, config.port)],
        ['Database', 'PostgreSQL, migrated'],
        ['Files', config.server.filesDir],
        ['Seal', sealNote],
        ['API keys', `${config.server.apiKeys.length} from API_KEYS`],
      ]) +
      `\n\nNew API key: run npx codevibe-sign api-key, add it to API_KEYS and restart.\n` +
      `Press Ctrl+C to stop.`,
  );
  const signal = await stop();
  io.out(`\n${signal} received, closing`);
  await running.close();
  return EXIT.ok;
}

export function startCommand(stop: StopSignal = processSignal): Command {
  return {
    name: 'start',
    summary: 'Run the signing server (add --memory to try it with no setup)',
    help: `Usage
  codevibe-sign-server start --memory [options]   try it: in-memory, nothing to set up
  codevibe-sign-server start [options]            the real service, from environment variables

--memory keeps everything in memory, seals with a generated self-signed certificate,
prints emails and one-time codes to the console and prints a fresh API key. For local
development only: everything is gone when it stops.

Without --memory it runs the same service as the Docker image, configured from the same
environment variables (DATABASE_URL, PUBLIC_URL, API_KEYS, SEAL_P12_BASE64,
SEAL_P12_PASSPHRASE, SMTP_HOST, SMTP_FROM and the optional ones). Every problem is
reported at once, by variable name.

Options (each one overrides its variable)
  -p, --port <n>           PORT (default 3000)
  --host <address>         HOST (default 0.0.0.0, or 127.0.0.1 with --memory)
  --public-url <url>       PUBLIC_URL, the base of signing links
  --database-url <url>     DATABASE_URL, PostgreSQL
  --files-dir <dir>        FILES_DIR (default ./data/files)
  --seal <file.p12>        Read SEAL_P12_BASE64 from a PKCS#12 file
  --memory                 In-memory development mode
  -h, --help               Show this help

The seal passphrase, SMTP password and API keys are read from the environment only.
Variables: https://sign.codevibe.in/docs/getting-started/docker?utm_source=cli

Examples
  npx @codevibe_technology/sign-server start --memory
  SEAL_P12_PASSPHRASE=... codevibe-sign-server start --seal seal.p12 --public-url https://sign.example.com`,

    async run(args, io) {
      const { values, positionals } = parse(args, FLAGS);
      if (positionals.length > 0) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
      const env = await envFrom(values, io.env);
      return values.memory ? startMemory(env, io, stop) : startStandalone(env, io, stop);
    },
  };
}
