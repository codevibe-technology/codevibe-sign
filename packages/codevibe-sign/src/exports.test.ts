import { describe, expect, it } from 'vitest';

describe('package entry points', () => {
  it('exposes the server, client, pdf and core from the root', async () => {
    const root = await import('codevibe-sign');
    for (const name of [
      'createSignServer',
      'startSignServer',
      'memoryStore',
      'createSignClient',
      'createSignerClient',
      'verifyWebhook',
      'verify',
      'seal',
      'SignError',
      'createDevSeal',
    ]) {
      expect(typeof (root as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('keeps each subpath to its own package', async () => {
    const client = await import('codevibe-sign/client');
    expect(typeof client.createSignClient).toBe('function');
    expect('createSignServer' in client).toBe(false);
    const pdf = await import('codevibe-sign/pdf');
    expect(typeof pdf.verify).toBe('function');
    const core = await import('codevibe-sign/core');
    expect(typeof core.verifyChain).toBe('function');
    const server = await import('codevibe-sign/server');
    expect(typeof server.configFromEnv).toBe('function');
  });
});
