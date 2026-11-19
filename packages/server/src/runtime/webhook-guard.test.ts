import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { envelopeBody, harness, WEBHOOK_SECRET } from '../testing/harness';
import {
  checkWebhookUrl,
  isPublicAddress,
  pinnedPost,
  resolveWebhookAddress,
  WebhookAddressError,
} from './webhook-guard';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '2002:a00:1::1',
    '2001:db8::1',
    'not-an-ip',
  ])('refuses %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '93.184.215.14',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ])('accepts %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe('checkWebhookUrl', () => {
  it('accepts https on a host name, on 443 or a high port', () => {
    expect(checkWebhookUrl('https://hooks.example.com/sign').host).toBe('hooks.example.com');
    expect(checkWebhookUrl('https://hooks.example.com:8443/sign').port).toBe('8443');
  });

  it.each([
    ['http://hooks.example.com/sign', /https/],
    ['https://user:pass@hooks.example.com/', /credentials/],
    ['https://hooks.example.com:22/', /privileged port/],
    ['https://10.0.0.1/', /host name/],
    ['https://[::1]/', /host name/],
    ['ftp://hooks.example.com/', /https/],
    ['not a url', /valid URL/],
  ])('refuses %s', (url, message) => {
    expect(() => checkWebhookUrl(url)).toThrow(message);
  });

  it('applies the allow-list', () => {
    const security = { allowHosts: ['.example.com', 'hooks.internal'] };
    expect(() => checkWebhookUrl('https://a.example.com/', security)).not.toThrow();
    expect(() => checkWebhookUrl('https://hooks.internal/', security)).not.toThrow();
    expect(() => checkWebhookUrl('https://example.com/', security)).toThrow(/allow-list/);
    expect(() => checkWebhookUrl('https://evil.test/', security)).toThrow(/allow-list/);
  });

  it('allows http and local hosts only with the development flag', () => {
    expect(() =>
      checkWebhookUrl('http://localhost:3000/hook', { allowInsecure: true }),
    ).not.toThrow();
    expect(() =>
      checkWebhookUrl('http://127.0.0.1:80/hook', { allowInsecure: true }),
    ).not.toThrow();
  });
});

describe('resolveWebhookAddress', () => {
  const url = new URL('https://hooks.example.com/sign');

  it('returns a public address to connect to', async () => {
    const lookup = async () => ['93.184.215.14'];
    expect(await resolveWebhookAddress(url, { lookup })).toBe('93.184.215.14');
  });

  it('refuses a name with any private answer, so rebinding cannot slip one in', async () => {
    const lookup = async () => ['93.184.215.14', '169.254.169.254'];
    await expect(resolveWebhookAddress(url, { lookup })).rejects.toBeInstanceOf(
      WebhookAddressError,
    );
  });

  it('trusts allow-listed hosts wherever they resolve, and refuses unresolvable names', async () => {
    const lookup = async () => ['10.0.0.7'];
    expect(await resolveWebhookAddress(url, { lookup, allowHosts: ['hooks.example.com'] })).toBe(
      '10.0.0.7',
    );
    await expect(resolveWebhookAddress(url, { lookup: async () => [] })).rejects.toThrow(
      /does not resolve/,
    );
  });
});

describe('pinnedPost', () => {
  let server: Server | undefined;
  afterEach(
    () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  );

  async function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return (server!.address() as AddressInfo).port;
  }

  const post = (port: number, path = '/hook', totalTimeoutMs = 2_000) =>
    pinnedPost({
      url: new URL(`http://hooks.invalid:${port}${path}`),
      address: '127.0.0.1',
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      connectTimeoutMs: 1_000,
      totalTimeoutMs,
      maxResponseBytes: 64 * 1024,
    });

  it('connects to the checked address, not to whatever the name resolves to', async () => {
    let seen: { host?: string; body: string } | undefined;
    const port = await serve((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        seen = { host: req.headers.host, body };
        res.writeHead(204).end();
      });
    });
    expect(await post(port)).toBe(204);
    expect(seen).toEqual({ host: `hooks.invalid:${port}`, body: '{"ok":true}' });
  });

  it('does not follow redirects', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
    });
    expect(await post(port)).toBe(302);
  });

  it('stops reading a large response', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024, 'x');
      for (let i = 0; i < 64; i++) res.write(chunk);
      res.end();
    });
    expect(await post(port)).toBe(200);
  });

  it('gives up on a receiver that never answers', async () => {
    const port = await serve(() => undefined);
    await expect(post(port, '/hook', 200)).rejects.toThrow(/timed out/);
  });
});

describe('webhook delivery', () => {
  it('refuses to start with an http or private webhook URL', () => {
    const webhooks = [
      { url: 'http://hooks.example.com/sign', secret: WEBHOOK_SECRET, events: ['*'] },
    ];
    expect(() => harness({ webhooks })).toThrow(/https/);
    expect(() =>
      harness({ webhooks: [{ ...webhooks[0]!, url: 'https://169.254.169.254/' }] }),
    ).toThrow(/host name/);
    expect(() => harness({ webhooks, webhookSecurity: { allowInsecure: true } })).not.toThrow();
  });

  it('does not deliver when the host resolves to a private address', async () => {
    const h = harness({ webhookSecurity: { lookup: async () => ['10.0.0.8'] } });
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    expect(h.deliveries).toHaveLength(0);
    expect(JSON.stringify(h.logs)).toMatch(/private or reserved/);
  });
});
