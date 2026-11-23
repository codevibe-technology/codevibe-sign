import { consoleMailer, consoleOtpSender } from '../adapters/mail';
import { memoryFileStore } from '../adapters/files';
import type { SignServerOptions } from '../options';
import { createSignServer } from '../server';
import { memoryStore } from '../store/memory';
import { fakePdf, fakePdfEngine } from './fake-pdf';

export const API_KEY = 'test-key-0123456789abcdef';
export const WEBHOOK_SECRET = 'whsec-0123456789abcdef';
export const START = new Date('2026-03-02T09:00:00.000Z');

export interface Delivery {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A server wired to in-memory adapters, a controllable clock and a recording fetch. */
export function harness(overrides: Partial<SignServerOptions> = {}) {
  let now = START.getTime();
  const clock = { now: () => new Date(now) };
  const mailer = consoleMailer({ silent: true });
  const otp = consoleOtpSender({ silent: true });
  const store = memoryStore();
  const files = memoryFileStore();
  const deliveries: Delivery[] = [];
  let webhookStatus = 200;
  const logs: { level: string; message: string; meta?: Record<string, unknown> }[] = [];

  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    deliveries.push({ url: String(url), headers, body: String(init?.body) });
    return new Response(null, { status: webhookStatus });
  }) as typeof fetch;

  const server = createSignServer({
    store,
    files,
    mailer,
    otp,
    clock,
    pdf: fakePdfEngine(),
    sealer: { p12: new Uint8Array([1, 2, 3]), passphrase: 'secret', reason: 'Test seal' },
    apiKeys: [API_KEY],
    publicUrl: 'https://sign.example.com/',
    webhooks: [{ url: 'https://hooks.example.com/sign', secret: WEBHOOK_SECRET, events: ['*'] }],
    fetch: fetchStub,
    webhookSecurity: { lookup: async () => ['93.184.215.14'] },
    logger: {
      error: (message, meta) => logs.push({ level: 'error', message, ...(meta ? { meta } : {}) }),
      warn: (message, meta) => logs.push({ level: 'warn', message, ...(meta ? { meta } : {}) }),
      info: (message, meta) => logs.push({ level: 'info', message, ...(meta ? { meta } : {}) }),
    },
    ...overrides,
  });

  async function call(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {},
  ) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.auth !== false && path.startsWith('/v1/envelopes')) {
      headers.authorization ??= `Bearer ${API_KEY}`;
    }
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) body = options.body;
    else if (typeof options.body === 'string') body = options.body;
    else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await server.app.request(path, { method, headers, body });
    const type = res.headers.get('content-type') ?? '';
    const json = type.includes('application/json') ? await res.json() : undefined;
    // Responses are checked field by field in tests; a loose type keeps them readable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { res, status: res.status, json: json as any };
  }

  /** The token from the last signing link mailed to `email`. */
  function tokenFor(email: string): string {
    const mail = [...mailer.sent].reverse().find((m) => m.to === email && /\/sign\//.test(m.text));
    const token = mail?.text.match(/\/sign\/([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`No signing link sent to ${email}`);
    return token;
  }

  return {
    server,
    store,
    files,
    mailer,
    otp,
    deliveries,
    logs,
    call,
    tokenFor,
    advance(ms: number) {
      now += ms;
    },
    setWebhookStatus(status: number) {
      webhookStatus = status;
    },
  };
}

export const pdfBase64 = (pages = 1) => Buffer.from(fakePdf(pages)).toString('base64');

/** Two signers in order, one signature field each, and a viewer. */
export function envelopeBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Offer letter',
    documents: [{ key: 'offer', name: 'offer.pdf', content: pdfBase64(2) }],
    recipients: [
      { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' },
      { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', auth: 'email_link' },
      { key: 'hr', name: 'HR Team', email: 'hr@example.com', role: 'viewer', auth: 'email_link' },
    ],
    fields: [
      { recipient: 'asha', type: 'signature', page: 1, x: 72, y: 600, width: 180, height: 48 },
      { recipient: 'ravi', type: 'signature', page: 1, x: 300, y: 600, width: 180, height: 48 },
      {
        recipient: 'ravi',
        type: 'text',
        page: 0,
        x: 72,
        y: 100,
        width: 200,
        height: 20,
        required: false,
      },
    ],
    ...overrides,
  };
}

/** A real 1x1 PNG, base64. */
export const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
