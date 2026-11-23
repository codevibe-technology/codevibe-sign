// @vitest-environment jsdom
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Envelope, Field, FieldValue } from '@codevibe_technology/sign-core';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  memoryStore,
  type SignServer,
} from '@codevibe_technology/sign-server';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Brand } from '@/server/brand';
import { makeP12, makePdf, PNG } from './fixtures';

const APP_URL = 'http://localhost:3000';
const WORKSPACE = { id: 'ws_00112233445566778899', slug: 'acme', name: 'Acme' };

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  user: { id: 'u_asha', name: 'Asha Rao', email: 'asha@acme.test', image: null },
}));

vi.mock('@/server/env', () => ({ env: () => state.config }));
vi.mock('@/server/db', () => ({ db: () => ({}) }));
vi.mock('@/server/auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/envelopes', async (original) => ({
  ...(await original<typeof import('@/server/envelopes')>()),
  recordSender: async () => undefined,
  senderOf: async () => null,
}));
vi.mock('@/server/brand', async (original) => ({
  ...(await original<typeof import('@/server/brand')>()),
  getSigningBrand: async (_sql: unknown, workspaceId: string) =>
    workspaceId === WORKSPACE.id
      ? {
          name: 'Acme HR',
          logoUrl: null,
          brandColor: '#0F766E',
          font: 'inter',
          showBadge: false,
        }
      : null,
}));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('@codevibe_technology/sign-react/styles.css', () => ({}));
vi.mock('@codevibe_technology/sign-react', () => ({
  // Stands in for the canvas viewer, which jsdom cannot draw: it fetches the first document the
  // way pdf.js would and fills every field with a signature.
  SigningView: function SigningViewStub({
    documents,
    fields,
    onSubmit,
    labels,
  }: {
    documents: { file: string }[];
    fields: Field[];
    onSubmit: (values: FieldValue[]) => Promise<void>;
    labels: { finish: string };
  }) {
    const [bytes, setBytes] = useState<number | null>(null);
    useEffect(() => {
      void fetch(documents[0]!.file)
        .then((res) => res.arrayBuffer())
        .then((body) => setBytes(body.byteLength));
    }, [documents]);
    return (
      <div>
        <p data-testid="document-bytes">{bytes ?? ''}</p>
        <button
          type="button"
          onClick={() => void onSubmit(fields.map((f) => ({ fieldId: f.id, value: PNG })))}
        >
          {labels.finish}
        </button>
      </div>
    );
  },
}));

const brand: Brand = {
  workspaceId: WORKSPACE.id,
  logoUrl: null,
  brandColor: '#0F766E',
  font: 'inter',
  senderName: 'Acme HR',
  replyTo: 'hr@acme.test',
  emailOverrides: { invite: { subject: '{{company}}: please {{action}} {{document_title}}' } },
  signingDomain: null,
  signingDomainVerified: false,
  certificateFooter: 'Acme Private Limited',
  showBadge: false,
};

/** The browser: a cookie jar and same-origin fetches routed to the app's own handlers. */
function browser() {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const [name, value = ''] = pair!.split('=');
      if (!value || attributes.some((a) => /max-age=0\b/i.test(a.trim()))) jar.delete(name!);
      else jar.set(name!, value);
    }
    return res;
  };
  const headers = (init: RequestInit = {}) => {
    const out = new Headers(init.headers);
    out.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    out.set('sec-fetch-site', 'same-origin');
    return out;
  };
  return { jar, keep, headers };
}

describe('send through the app, then sign through the /sign page', () => {
  let dir: string;
  let sign: SignServer;
  const mailer = consoleMailer({ silent: true });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cvs-web-sign-'));
    const p12 = makeP12('pass');
    writeFileSync(join(dir, 'seal.p12'), p12);
    state.config = {
      APP_URL,
      SEAL_P12_PATH: join(dir, 'seal.p12'),
      SEAL_PASSPHRASE: 'pass',
      SEAL_ALLOW_WEAK_KEY: false,
    };
    const { createAuthenticate } = await import('@/server/sign/principal');
    const { createWorkspaceMail } = await import('@/server/sign/mail');
    sign = createSignServer({
      store: memoryStore(),
      files: memoryFileStore(),
      mailer,
      otp: consoleOtpSender({ silent: true }),
      sealer: { p12, passphrase: 'pass' },
      apiKeys: [],
      authenticate: createAuthenticate({
        appUrl: APP_URL,
        resolveApiKey: async () => null,
        sessionUser: async (h) => (/session=asha/.test(h.get('cookie') ?? '') ? state.user : null),
        roleOf: async (_user, workspaceId) => (workspaceId === WORKSPACE.id ? 'member' : null),
        isSender: async () => true,
      }),
      webhookTargets: async () => [],
      workspaceMail: createWorkspaceMail({
        appUrl: APP_URL,
        brand: async () => brand,
        workspaceName: async (id) => (id === WORKSPACE.id ? WORKSPACE.name : null),
      }),
      certificateNote: async () => brand.certificateFooter,
      basePath: '/api',
      publicUrl: APP_URL,
      signingPageUrl: `${APP_URL}/sign`,
    });
    (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign = sign;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign;
    vi.unstubAllGlobals();
  });

  it('mails a branded invite, signs on the page and hands out the sealed copy', async () => {
    const api = await import('@/app/api/v1/[...path]/route');
    const link = await import('@/app/api/sign/[token]/route');
    const brandRoute = await import('@/app/brand/[workspaceId]/signing/route');
    const { default: SigningPage } = await import('@/app/sign/page');
    const { verifyUpload } = await import('@/server/pdf');

    const created = await api.POST(
      new Request(`${APP_URL}/api/v1/envelopes`, {
        method: 'POST',
        headers: {
          cookie: 'session=asha',
          'x-workspace': WORKSPACE.id,
          origin: APP_URL,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Offer <letter>',
          send: true,
          documents: [
            {
              key: 'd',
              name: 'offer.pdf',
              content: Buffer.from(await makePdf(1)).toString('base64'),
            },
          ],
          recipients: [
            { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', auth: 'email_link' },
            { key: 'hr', name: 'HR', email: 'hr@example.com', role: 'viewer' },
          ],
          fields: [
            {
              recipient: 'ravi',
              type: 'signature',
              page: 0,
              x: 72,
              y: 600,
              width: 180,
              height: 48,
            },
          ],
        }),
      }),
    );
    expect(created.status).toBe(201);
    const envelope = (await created.json()) as Envelope;
    expect(envelope.status).toBe('sent');

    const invite = mailer.sent.find((m) => m.to === 'ravi@example.com')!;
    expect(invite).toMatchObject({
      subject: 'Acme HR: please sign Offer <letter>',
      fromName: 'Acme HR',
      replyTo: 'hr@acme.test',
    });
    expect(invite.html).toContain('Offer &lt;letter&gt;');
    expect(invite.html).toContain('background:#0F766E');
    const token = /\/api\/sign\/([\w-]{43})/.exec(invite.text)![1]!;

    const { jar, keep, headers } = browser();
    const opened = keep(await link.GET(new Request(`${APP_URL}/api/sign/${token}`)));
    expect(opened.status).toBe(303);
    expect(opened.headers.get('location')).toBe(`${APP_URL}/sign`);
    expect(jar.get('cvsign_link')).toBe(token);

    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
        const url = new URL(String(input), APP_URL);
        const brandPath = /^\/brand\/([^/]+)\/signing$/.exec(url.pathname);
        if (brandPath) {
          return brandRoute.GET(new Request(url), {
            params: Promise.resolve({ workspaceId: brandPath[1]! }),
          });
        }
        const request = new Request(url, { ...init, headers: headers(init) });
        const handler = request.method === 'POST' ? api.POST : api.GET;
        return keep(await handler(request));
      },
    );

    const page = await SigningPage({ searchParams: Promise.resolve({}) });
    const user = userEvent.setup();
    const { unmount } = render(page);

    expect(
      await screen.findByRole('heading', { name: 'Acme HR asks you to sign “Offer <letter>”' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('banner').querySelector<HTMLElement>('[data-brand-stripe]')?.style
        .background,
    ).toBe('rgb(15, 118, 110)');
    expect(screen.queryByText('Secured by Codevibe Sign')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: /legally binding/ }));
    await user.click(screen.getByRole('button', { name: 'Continue to the document' }));
    await vi.waitFor(() =>
      expect(Number(screen.getByTestId('document-bytes').textContent)).toBeGreaterThan(500),
    );
    await user.click(screen.getByRole('button', { name: 'Finish and sign' }));

    expect(await screen.findByRole('heading', { name: 'Thank you, Ravi' })).toBeTruthy();
    const download = await screen.findByRole('link', { name: 'Download your copy' });
    expect(jar.has('cvsign_receipt')).toBe(true);

    const copy = await fetch(download.getAttribute('href')!);
    expect(copy.headers.get('content-type')).toBe('application/pdf');
    const sealed = new Uint8Array(await copy.arrayBuffer());
    expect(await verifyUpload(sealed)).toMatchObject({ valid: true });

    const done = mailer.sent.filter((m) => m.subject === 'Completed: "Offer <letter>"');
    expect(done.map((m) => m.to).sort()).toEqual(['hr@example.com', 'ravi@example.com']);
    expect(done[0]).toMatchObject({ fromName: 'Acme HR' });
    unmount();

    const again = await link.GET(new Request(`${APP_URL}/api/sign/${token}`));
    const location = new URL(again.headers.get('location')!);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      state: 'completed',
      w: WORKSPACE.id,
    });
    render(
      await SigningPage({
        searchParams: Promise.resolve(Object.fromEntries(location.searchParams)),
      }),
    );
    expect(screen.getByRole('heading', { name: 'This document is complete' })).toBeTruthy();
    expect(screen.getByRole('banner')).toHaveTextContent('Acme HR');
  }, 60_000);
});
