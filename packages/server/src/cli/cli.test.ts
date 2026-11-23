import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifySeal } from '@codevibe_technology/sign-pdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from '../testing/real-pdf';

const BIN = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ENV = { PATH: process.env.PATH ?? '', NO_COLOR: '1' };

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: ENV });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Resolves once the text `read()` returns matches, polling as the child writes. */
async function waitFor(read: () => string, pattern: RegExp): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (!pattern.test(read())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${pattern}:\n${read()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return read();
}

beforeAll(() => {
  if (!existsSync(BIN)) throw new Error('Build the package first: pnpm build');
});

describe('codevibe-sign-server', () => {
  it('prints help and the version', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('codevibe-sign-server <command>');
    expect(help.stdout).toContain('AGPL-3.0-only');
    const version = await cli(['--version']);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const start = await cli(['start', '--help']);
    expect(start.code).toBe(0);
    expect(start.stdout).toContain('--memory');
  });

  it('refuses a command it does not know', async () => {
    const run = await cli(['verify']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Unknown command: verify');
  });
});

describe('start', () => {
  it('runs in memory, completes an envelope, and shuts down cleanly', async () => {
    const child = spawn(process.execPath, [BIN, 'start', '--memory', '--port', '0'], { env: ENV });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    try {
      const banner = await waitFor(() => output, /Press Ctrl\+C to stop/);
      expect(banner).toContain('memory mode');
      const port = /Health\s+http:\/\/localhost:(\d+)\/health/.exec(banner)?.[1];
      const apiKey = /API key\s+(\S+)/.exec(banner)?.[1];
      expect(port).toBeDefined();
      const baseUrl = `http://127.0.0.1:${port}`;
      const sender = { authorization: `Bearer ${apiKey}` };
      const json = { 'content-type': 'application/json' };

      const health = await fetch(`${baseUrl}/health`);
      expect(await health.json()).toEqual({ ok: true });

      const created = await fetch(`${baseUrl}/v1/envelopes`, {
        method: 'POST',
        headers: { ...sender, ...json },
        body: JSON.stringify({
          title: 'Offer letter',
          send: true,
          documents: [
            {
              key: 'doc',
              name: 'offer.pdf',
              content: Buffer.from(await makePdf(1)).toString('base64'),
            },
          ],
          recipients: [
            { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' },
          ],
          fields: [
            {
              recipient: 'asha',
              type: 'signature',
              page: 0,
              x: 72,
              y: 640,
              width: 180,
              height: 48,
            },
          ],
        }),
      });
      expect(created.status).toBe(201);
      const envelope = (await created.json()) as { id: string; documents: { id: string }[] };

      await waitFor(() => output, /\/sign\/[A-Za-z0-9_-]{20,}/);
      const token = /\/sign\/([A-Za-z0-9_-]{20,})/.exec(output)![1]!;
      const session = (await (await fetch(`${baseUrl}/v1/sign/${token}`)).json()) as {
        fields: { id: string }[];
      };
      await fetch(`${baseUrl}/v1/sign/${token}/view`, { method: 'POST' });
      const submitted = await fetch(`${baseUrl}/v1/sign/${token}/submit`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          consent: true,
          values: [{ fieldId: session.fields[0]!.id, value: PNG }],
        }),
      });
      expect(submitted.status).toBe(200);

      const sealed = await fetch(
        `${baseUrl}/v1/envelopes/${envelope.id}/documents/${envelope.documents[0]!.id}?version=sealed`,
        { headers: sender },
      );
      expect(sealed.status).toBe(200);
      const check = await verifySeal(new Uint8Array(await sealed.arrayBuffer()));
      expect(check).toMatchObject({ valid: true, coversWholeDocument: true, signatureCount: 1 });
    } finally {
      const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
      child.kill('SIGINT');
      expect(await exit).toBe(0);
    }
    expect(output).toContain('SIGINT received, closing');
  }, 30_000);

  it('lists every missing variable without --memory', async () => {
    const run = await cli(['start']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('DATABASE_URL is required');
    expect(run.stderr).toContain('API_KEYS is required');
    expect(run.stderr).toContain('codevibe-sign-server start --memory');
  });

  it('rejects a bad port', async () => {
    const run = await cli(['start', '--memory', '--port', 'eighty']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--port');
  });
});
