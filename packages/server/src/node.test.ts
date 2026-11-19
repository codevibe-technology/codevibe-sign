import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import * as api from './index';
import { listen } from './node';
import { harness } from './testing/harness';

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
