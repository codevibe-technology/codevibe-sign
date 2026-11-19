import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  memoryStore,
  type PdfEngine,
  type SignServerOptions,
} from '@codevibe/sign-server';

export const API_KEY = 'test-key-0123456789abcdef';
export const WEBHOOK_SECRET = 'whsec-0123456789abcdef';
export const BASE_URL = 'https://sign.example.com';

/** A real 1x1 PNG, base64. */
export const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const encoder = new TextEncoder();

/** A stand-in PDF the fake engine reads: `%PDF-1.7` then `pages=<n>`. */
export function fakePdf(pages = 1): Uint8Array {
  return encoder.encode(`%PDF-1.7\npages=${pages}\n`);
}

function append(pdf: Uint8Array, text: string): Uint8Array {
  const tail = encoder.encode(text);
  const out = new Uint8Array(pdf.byteLength + tail.byteLength);
  out.set(pdf);
  out.set(tail, pdf.byteLength);
  return out;
}

const fakeEngine: PdfEngine = {
  async inspectPdf(pdf) {
    const pages = Number(/pages=(\d+)/.exec(new TextDecoder().decode(pdf))?.[1] ?? 1);
    return {
      pageCount: pages,
      pages: Array.from({ length: pages }, () => ({ width: 612, height: 792 })),
    };
  },
  renderFields: async (pdf) => pdf,
  appendCertificate: async (pdf) => append(pdf, 'certificate\n'),
  seal: async (pdf) => append(pdf, 'sealed\n'),
};

export interface Delivery {
  headers: Headers;
  body: string;
}

/** The real server app with memory adapters, reachable through `fetch`. */
export function testServer(overrides: Partial<SignServerOptions> = {}) {
  const mailer = consoleMailer({ silent: true });
  const otp = consoleOtpSender({ silent: true });
  const deliveries: Delivery[] = [];
  const server = createSignServer({
    store: memoryStore(),
    files: memoryFileStore(),
    mailer,
    otp,
    pdf: fakeEngine,
    sealer: { p12: new Uint8Array([1]), passphrase: 'unused' },
    apiKeys: [API_KEY],
    publicUrl: BASE_URL,
    webhooks: [{ url: 'https://hooks.example.com/sign', secret: WEBHOOK_SECRET, events: ['*'] }],
    webhookSecurity: { lookup: async () => ['93.184.215.14'] },
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      deliveries.push({ headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    ...overrides,
  });
  const requests: Request[] = [];
  const fetchShim = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return server.app.fetch(request);
  }) as typeof fetch;

  return {
    server,
    fetch: fetchShim,
    requests,
    deliveries,
    otp,
    /** The token from the last signing link mailed to `email`. */
    tokenFor(email: string): string {
      const mail = [...mailer.sent]
        .reverse()
        .find((m) => m.to === email && /\/sign\//.test(m.text));
      const token = mail?.text.match(/\/sign\/([A-Za-z0-9_-]+)/)?.[1];
      if (!token) throw new Error(`No signing link sent to ${email}`);
      return token;
    },
  };
}
