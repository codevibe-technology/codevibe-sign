import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import * as api from './index';
import { listen, startSignServer } from './node';
import { harness } from './testing/harness';
import { makeP12, makePdf } from './testing/real-pdf';

describe('listen', () => {
  it('serves the app over HTTP', async () => {
    const h = harness();
    const server = await listen(h.server.app, { port: 0, hostname: '127.0.0.1' });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('public api', () => {
  it('exports the server, runtime entry and adapters', () => {
    for (const name of [
      'createSignServer',
      'startSignServer',
      'memoryStore',
      'postgresStore',
      'migrate',
      'localFileStore',
      'smtpMailer',
      'consoleMailer',
      'consoleOtpSender',
      'verifyWebhook',
    ]) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('startSignServer on PostgreSQL', () => {
  it('migrates, serves, runs ticks and closes cleanly', async () => {
    const schema = `sign_node_${process.pid}_${Date.now()}`;
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    const files = await mkdtemp(join(tmpdir(), 'sign-files-'));
    try {
      const withSchema = new URL(url!);
      withSchema.searchParams.set('search_path', schema);
      const running = await startSignServer({
        databaseUrl: withSchema.toString(),
        filesDir: files,
        smtp: { host: '127.0.0.1', port: 2525, secure: false, from: 'Sign <sign@example.com>' },
        seal: { p12: makeP12('Node Test Seal', 'node-pass'), passphrase: 'node-pass' },
        apiKeys: ['k'.repeat(32)],
        publicUrl: 'http://localhost:3000',
        tickIntervalMs: 50,
      });
      await running.listen(0, '127.0.0.1');
      const tables = await admin<{ name: string }[]>`
        select table_name as name from information_schema.tables where table_schema = ${schema}`;
      expect(tables.map((t) => t.name)).toContain('sign_envelopes');

      const created = await running.server.app.request('/v1/envelopes', {
        method: 'POST',
        headers: { authorization: `Bearer ${'k'.repeat(32)}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Draft only',
          documents: [{ name: 'a.pdf', content: Buffer.from(await makePdf(1)).toString('base64') }],
          recipients: [{ name: 'Asha Rao', email: 'asha@example.com' }],
        }),
      });
      expect(created.status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await running.close();

      const [row] = await admin<{ count: number }[]>`
        select count(*)::int as count from ${admin(schema)}.sign_envelopes`;
      expect(row?.count).toBe(1);
    } finally {
      await admin.unsafe(`drop schema ${schema} cascade`);
      await admin.end();
      await rm(files, { recursive: true, force: true });
    }
  }, 30_000);
});
