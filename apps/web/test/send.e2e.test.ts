import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Envelope } from '@codevibe_technology/sign-core';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  memoryStore,
  type SignServer,
} from '@codevibe_technology/sign-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import { draftBody, type SendFlowState } from '@/lib/send-flow';
import { makeP12, makePdf, PNG } from './fixtures';

const APP_URL = 'http://localhost:3000';
const WORKSPACE = { id: 'ws_acme', slug: 'acme', name: 'Acme' };

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; image: null } | null,
  roles: {} as Record<string, Role>,
  senders: new Map<string, string>(),
  config: {} as Record<string, unknown>,
}));

vi.mock('@/server/env', () => ({ env: () => state.config }));
vi.mock('@/server/db', () => ({ db: () => ({}) }));
vi.mock('@/server/auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/auth/guards', () => ({
  findWorkspaceAccess: async (slug: string) =>
    state.user && slug === WORKSPACE.slug && state.roles[state.user.id]
      ? { workspace: WORKSPACE, role: state.roles[state.user.id], user: state.user }
      : null,
}));
vi.mock('@/server/envelopes', async (original) => ({
  ...(await original<typeof import('@/server/envelopes')>()),
  recordSender: async (_sql: unknown, input: { envelopeId: string; userId: string }) => {
    state.senders.set(input.envelopeId, input.userId);
  },
  senderOf: async (_sql: unknown, _ws: string, envelopeId: string) =>
    state.senders.has(envelopeId) ? { userId: state.senders.get(envelopeId)!, name: null } : null,
}));

const people = {
  asha: { id: 'u_asha', name: 'Asha Rao', email: 'asha@acme.test', image: null },
  mia: { id: 'u_mia', name: 'Mia', email: 'mia@acme.test', image: null },
  vic: { id: 'u_vic', name: 'Vic', email: 'vic@acme.test', image: null },
};

describe('send, sign, seal and verify through the app', () => {
  let dir: string;
  let sign: SignServer;
  const mailer = consoleMailer({ silent: true });
  let route: typeof import('@/app/api/v1/[...path]/route');

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cvs-web-e2e-'));
    const p12 = makeP12('pass');
    writeFileSync(join(dir, 'seal.p12'), p12);
    state.config = {
      APP_URL,
      SEAL_P12_PATH: join(dir, 'seal.p12'),
      SEAL_PASSPHRASE: 'pass',
      SEAL_ALLOW_WEAK_KEY: false,
    };
    state.roles = { u_asha: 'member', u_mia: 'member', u_vic: 'viewer' };
    const { createAuthenticate } = await import('@/server/sign/principal');
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
        sessionUser: async (headers) => {
          const id = /session=(\w+)/.exec(headers.get('cookie') ?? '')?.[1];
          return id ? { id } : null;
        },
        roleOf: async (userId, workspaceId) =>
          workspaceId === WORKSPACE.id ? (state.roles[userId] ?? null) : null,
        isSender: async (userId, _ws, envelopeId) => state.senders.get(envelopeId) === userId,
      }),
      webhookTargets: async () => [],
      basePath: '/api',
      publicUrl: APP_URL,
      signingPageUrl: `${APP_URL}/sign`,
    });
    (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign = sign;
    route = await import('@/app/api/v1/[...path]/route');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign;
  });

  /** A browser call from the app: session cookie, X-Workspace, same origin. */
  function browser(as: keyof typeof people, path: string, init: RequestInit = {}) {
    state.user = people[as];
    const headers = new Headers(init.headers);
    headers.set('cookie', `session=${people[as].id}`);
    headers.set('x-workspace', WORKSPACE.id);
    headers.set('origin', APP_URL);
    if (typeof init.body === 'string') headers.set('content-type', 'application/json');
    return new Request(`${APP_URL}/api${path}`, { ...init, headers });
  }

  const handler = (request: Request) =>
    request.method === 'POST'
      ? route.POST(request)
      : request.method === 'PATCH'
        ? route.PATCH(request)
        : route.GET(request);

  async function call<T>(as: keyof typeof people, path: string, init?: RequestInit) {
    const res = await handler(browser(as, path, init));
    return { status: res.status, body: (await res.json()) as T };
  }

  async function createDraft(as: keyof typeof people, title: string) {
    const form = new FormData();
    form.set(
      'envelope',
      JSON.stringify({
        title,
        routing: 'sequential',
        recipients: [
          { key: 'r1', name: 'Ravi Kumar', email: 'ravi@example.com', role: 'signer' },
          { key: 'r2', name: 'HR', email: 'hr@example.com', role: 'viewer' },
        ],
        documents: [{ key: 'd1', name: 'offer.pdf' }],
      }),
    );
    form.append(
      'documents',
      new Blob([await makePdf(2)], { type: 'application/pdf' }),
      'offer.pdf',
    );
    return call<Envelope>(as, '/v1/envelopes', { method: 'POST', body: form });
  }

  function tokenFor(email: string) {
    const mail = [...mailer.sent].reverse().find((m) => m.to === email && /\/sign\//.test(m.text));
    const token = mail?.text.match(/\/sign\/([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error(`no signing link for ${email}`);
    return token;
  }

  it('runs the whole flow and hands out a sealed PDF that verifies', async () => {
    const created = await createDraft('asha', 'Offer letter');
    expect(created.status).toBe(201);
    const draft = created.body;
    expect(draft.status).toBe('draft');
    expect(state.senders.get(draft.id)).toBe('u_asha');

    const [ravi, hr] = draft.recipients;
    const flow: SendFlowState = {
      envelopeId: draft.id,
      documents: draft.documents.map((d) => ({
        id: d.id,
        name: d.name,
        size: 0,
        pages: d.pageSizes ?? [],
      })),
      recipients: [ravi!, hr!].map((r) => ({
        id: r.id,
        saved: true,
        name: r.name,
        email: r.email ?? '',
        phone: '',
        role: r.role,
        auth: 'email_link' as const,
      })),
      routing: 'sequential',
      fields: [
        {
          id: 'local_1',
          documentId: draft.documents[0]!.id,
          recipientId: ravi!.id,
          type: 'signature',
          page: 1,
          rect: { x: 72, y: 600, width: 180, height: 48 },
          required: true,
        },
      ],
      settings: {
        title: 'Offer letter',
        message: 'Please sign',
        expiresInDays: 14,
        remindEveryDays: 2,
      },
    };
    const saved = await call<Envelope>('asha', `/v1/envelopes/${draft.id}`, {
      method: 'PATCH',
      body: JSON.stringify(draftBody(flow)),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.fields).toHaveLength(1);
    expect(saved.body.recipients.map((r) => r.id)).toEqual([ravi!.id, hr!.id]);
    expect(saved.body.message).toBe('Please sign');

    const sent = await call<Envelope>('asha', `/v1/envelopes/${draft.id}/send`, {
      method: 'POST',
      body: '{}',
    });
    expect(sent.body.status).toBe('sent');

    const token = tokenFor('ravi@example.com');
    const page = await sign.app.fetch(new Request(`${APP_URL}/api/v1/sign/${token}`));
    const view = (await page.json()) as { fields: { id: string }[] };
    const submitted = await sign.app.fetch(
      new Request(`${APP_URL}/api/v1/sign/${token}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          values: view.fields.map((f) => ({ fieldId: f.id, value: PNG })),
        }),
      }),
    );
    expect(((await submitted.json()) as { envelopeStatus: string }).envelopeStatus).toBe(
      'completed',
    );

    const { signApi, userPrincipal } = await import('@/server/sign/api');
    const api = signApi(userPrincipal('u_vic', WORKSPACE.id, true));
    const done = await api.get(draft.id);
    expect(done.status).toBe('completed');
    const check = await api.verification(draft.id, done.documents[0]!.id);
    expect(check.valid).toBe(true);
    const events = await api.events(draft.id);
    expect(events.chainValid).toBe(true);

    state.user = people.vic;
    const documentRoute = await import(
      '@/app/dashboard/[slug]/envelopes/[id]/documents/[docId]/route'
    );
    const download = await documentRoute.GET(
      new Request(`${APP_URL}/dashboard/acme/envelopes/${draft.id}/documents/x?version=sealed`),
      { params: Promise.resolve({ slug: 'acme', id: draft.id, docId: done.documents[0]!.id }) },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
    const sealed = new Uint8Array(await download.arrayBuffer());

    const { verifyUpload } = await import('@/server/pdf');
    const verified = await verifyUpload(sealed);
    expect(verified).toMatchObject({ valid: true, signer: 'Acme seal, Acme' });
    const tampered = sealed.slice();
    const middle = Math.floor(tampered.length / 2);
    tampered[middle] = tampered[middle]! ^ 0xff;
    expect((await verifyUpload(tampered)).valid).toBe(false);
    expect((await verifyUpload(await makePdf(1))).reason).toBe('not_sealed');

    state.user = { ...people.vic, id: 'u_stranger' };
    const outside = await documentRoute.GET(
      new Request(`${APP_URL}/dashboard/acme/envelopes/${draft.id}/documents/x?version=sealed`),
      { params: Promise.resolve({ slug: 'acme', id: draft.id, docId: done.documents[0]!.id }) },
    );
    expect(outside.status).toBe(404);
  }, 60_000);

  it('keeps viewers read-only and lets members void only what they sent', async () => {
    const asViewer = await createDraft('vic', 'Not allowed');
    expect(asViewer.status).toBe(403);

    const { body: envelope } = await createDraft('asha', 'Contract');
    const other = await call<{ error: { message: string } }>(
      'mia',
      `/v1/envelopes/${envelope.id}/void`,
      { method: 'POST', body: JSON.stringify({ reason: 'Not mine' }) },
    );
    expect(other.status).toBe(403);
    expect(other.body.error.message).toMatch(/admin/);

    state.roles.u_mia = 'admin';
    const admin = await call<Envelope>('mia', `/v1/envelopes/${envelope.id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Wrong person' }),
    });
    expect(admin.body.status).toBe('voided');
    state.roles.u_mia = 'member';

    const { body: own } = await createDraft('asha', 'Second contract');
    const voided = await call<Envelope>('asha', `/v1/envelopes/${own.id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Changed my mind' }),
    });
    expect(voided.body.status).toBe('voided');

    const listed = await call<{ envelopes: { id: string; status: string }[] }>(
      'vic',
      '/v1/envelopes?status=voided',
    );
    expect(listed.body.envelopes.map((e) => e.id)).toEqual([own.id, envelope.id]);
  });
});
