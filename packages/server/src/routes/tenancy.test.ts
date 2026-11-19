import { describe, expect, it } from 'vitest';
import { HttpError } from '../errors';
import { verifyWebhook } from '../runtime/webhooks';
import type { WebhookTarget } from '../options';
import { API_KEY, WEBHOOK_SECRET, envelopeBody, harness } from '../testing/harness';
import type { Principal } from '../tenancy';

const KEY_A = 'workspace-a-key-0123456789';
const KEY_B = 'workspace-b-key-0123456789';
const auth = (key: string) => ({ authorization: `Bearer ${key}` });

function tenants(targets: Record<string, WebhookTarget[]> = {}) {
  return harness({
    apiKeys: [
      API_KEY,
      { id: 'a', key: KEY_A, workspaceId: 'ws_a' },
      { id: 'b', key: KEY_B, workspaceId: 'ws_b' },
    ],
    webhookTargets: async (workspaceId) => targets[workspaceId] ?? [],
  });
}

async function createIn(h: ReturnType<typeof harness>, key: string, body = envelopeBody()) {
  const created = await h.call('POST', '/v1/envelopes', { body, headers: auth(key) });
  expect(created.status).toBe(201);
  return created.json as { id: string; documents: { id: string }[] };
}

describe('workspace isolation', () => {
  it('hides one workspace’s envelopes from another as if they did not exist', async () => {
    const h = tenants();
    const envelope = await createIn(h, KEY_A);
    const doc = envelope.documents[0]!.id;
    const id = envelope.id;

    const attempts: [string, string, unknown?][] = [
      ['GET', `/v1/envelopes/${id}`],
      ['PATCH', `/v1/envelopes/${id}`, { title: 'Taken over' }],
      ['POST', `/v1/envelopes/${id}/send`],
      ['POST', `/v1/envelopes/${id}/void`, { reason: 'no' }],
      ['GET', `/v1/envelopes/${id}/events`],
      ['GET', `/v1/envelopes/${id}/documents/${doc}`],
      ['GET', `/v1/envelopes/${id}/documents/${doc}?version=original`],
      ['GET', `/v1/envelopes/${id}/documents/${doc}/verification`],
      ['GET', `/v1/envelopes/${id}/certificate`],
    ];
    for (const key of [KEY_B, API_KEY]) {
      for (const [method, path, body] of attempts) {
        const res = await h.call(method, path, { body, headers: auth(key) });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.json.error.code).toBe('ENVELOPE_NOT_FOUND');
      }
      const missing = await h.call('GET', '/v1/envelopes/nope', { headers: auth(key) });
      expect(missing.json).toEqual(
        (await h.call('GET', `/v1/envelopes/${id}`, { headers: auth(key) })).json,
      );
    }

    const own = await h.call('GET', `/v1/envelopes/${id}`, { headers: auth(KEY_A) });
    expect(own.json).toMatchObject({ id, title: 'Offer letter', status: 'draft' });
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('lets the owning workspace act on its envelope', async () => {
    const h = tenants();
    const { id } = await createIn(h, KEY_A);
    const sent = await h.call('POST', `/v1/envelopes/${id}/send`, { headers: auth(KEY_A) });
    expect(sent.json.status).toBe('sent');
    const events = await h.call('GET', `/v1/envelopes/${id}/events`, { headers: auth(KEY_A) });
    expect(events.json.chainValid).toBe(true);
  });

  it('keeps default-workspace keys working exactly as before', async () => {
    const h = tenants();
    const { id } = await createIn(h, API_KEY);
    expect((await h.call('GET', `/v1/envelopes/${id}`)).status).toBe(200);
    expect((await h.call('GET', `/v1/envelopes/${id}`, { headers: auth(KEY_A) })).status).toBe(404);
    expect((await h.store.load(id))?.workspaceId).toBe('default');
  });

  it('lists only the caller’s envelopes', async () => {
    const h = tenants();
    const a1 = await createIn(h, KEY_A, envelopeBody({ title: 'A one' }));
    h.advance(1000);
    const a2 = await createIn(h, KEY_A, envelopeBody({ title: 'A two', send: true }));
    await createIn(h, KEY_B, envelopeBody({ title: 'B one' }));

    const list = await h.call('GET', '/v1/envelopes', { headers: auth(KEY_A) });
    expect(list.status).toBe(200);
    expect(list.json.envelopes.map((e: { id: string }) => e.id)).toEqual([a2.id, a1.id]);
    expect(list.json.envelopes[0]).toMatchObject({
      title: 'A two',
      status: 'sent',
      recipients: expect.arrayContaining([expect.objectContaining({ name: 'Asha Rao' })]),
    });
    expect(list.json.envelopes[0]).not.toHaveProperty('fields');
    expect(list.json.nextCursor).toBeNull();

    const page = await h.call('GET', '/v1/envelopes?limit=1', { headers: auth(KEY_A) });
    expect(page.json.envelopes).toHaveLength(1);
    const next = await h.call('GET', `/v1/envelopes?limit=1&cursor=${page.json.nextCursor}`, {
      headers: auth(KEY_A),
    });
    expect(next.json.envelopes[0].id).toBe(a1.id);

    const drafts = await h.call('GET', '/v1/envelopes?status=draft', { headers: auth(KEY_A) });
    expect(drafts.json.envelopes.map((e: { id: string }) => e.id)).toEqual([a1.id]);
    const search = await h.call('GET', '/v1/envelopes?q=one', { headers: auth(KEY_B) });
    expect(search.json.envelopes.map((e: { title: string }) => e.title)).toEqual(['B one']);
    expect((await h.call('GET', '/v1/envelopes')).json.envelopes).toEqual([]);
  });

  it('refuses bad list queries with the field to fix', async () => {
    const h = tenants();
    for (const [query, field] of [
      ['limit=0', 'limit'],
      ['limit=101', 'limit'],
      ['limit=ten', 'limit'],
      ['status=lost', 'status'],
      ['cursor=bad', 'cursor'],
    ]) {
      const res = await h.call('GET', `/v1/envelopes?${query}`, { headers: auth(KEY_A) });
      expect(res.status, query).toBe(400);
      expect(res.json.error.details.issues[0].path).toBe(field);
    }
  });

  it('scopes idempotency keys by workspace', async () => {
    const h = tenants();
    const headers = (key: string) => ({ ...auth(key), 'idempotency-key': 'same-key' });
    const body = envelopeBody();
    const a = await h.call('POST', '/v1/envelopes', { body, headers: headers(KEY_A) });
    const b = await h.call('POST', '/v1/envelopes', { body, headers: headers(KEY_B) });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.res.headers.get('idempotent-replayed')).toBeNull();
    expect(a.json.id).not.toBe(b.json.id);
  });
});

describe('webhooks per workspace', () => {
  const target = (url: string): WebhookTarget => ({ url, secret: WEBHOOK_SECRET, events: ['*'] });

  it('delivers a workspace’s events only to its own targets', async () => {
    const h = tenants({
      ws_a: [target('https://a.example.com/hook')],
      ws_b: [target('https://b.example.com/hook')],
    });
    await createIn(h, KEY_A, envelopeBody({ send: true }));
    const urls = new Set(h.deliveries.map((d) => d.url));
    expect(urls).toEqual(new Set(['https://a.example.com/hook']));
    for (const delivery of h.deliveries) {
      expect(JSON.parse(delivery.body).data.envelope.title).toBe('Offer letter');
    }

    h.deliveries.length = 0;
    await createIn(h, API_KEY, envelopeBody({ send: true }));
    expect(new Set(h.deliveries.map((d) => d.url))).toEqual(
      new Set(['https://hooks.example.com/sign']),
    );
  });

  it('looks the target up again before a retry, so a removed one stops', async () => {
    const targets: Record<string, WebhookTarget[]> = { ws_a: [target('https://a.example.com/x')] };
    const h = tenants(targets);
    h.setWebhookStatus(500);
    await createIn(h, KEY_A, envelopeBody({ send: true }));
    const failed = h.deliveries.length;
    expect(failed).toBeGreaterThan(0);

    targets.ws_a = [];
    h.setWebhookStatus(200);
    h.advance(10 * 60_000);
    await h.server.tick();
    expect(h.deliveries).toHaveLength(failed);
  });

  it('uses the secret the workspace has now', async () => {
    const targets: Record<string, WebhookTarget[]> = { ws_a: [target('https://a.example.com/x')] };
    const h = tenants(targets);
    h.setWebhookStatus(500);
    await createIn(h, KEY_A, envelopeBody({ send: true }));
    const rotated = 'rotated-secret-0123456789';
    targets.ws_a = [{ url: 'https://a.example.com/x', secret: rotated, events: ['*'] }];
    h.setWebhookStatus(200);
    h.deliveries.length = 0;
    h.advance(10 * 60_000);
    await h.server.tick();
    expect(h.deliveries.length).toBeGreaterThan(0);
    const delivery = h.deliveries[0]!;
    expect(
      verifyWebhook(rotated, delivery.headers['x-codevibe-signature'], delivery.body, {
        now: new Date(Date.parse('2026-03-02T09:10:00.000Z')),
      }),
    ).toBe(true);
  });
});

describe('authenticate option', () => {
  function withHook(resolve: (request: Request) => Promise<Principal | null>) {
    return harness({ apiKeys: [], authenticate: resolve });
  }

  it('acts as the principal it returns', async () => {
    const h = withHook(async (request) =>
      request.headers.get('x-user') === 'u1' ? { id: 'user:u1', workspaceId: 'ws_a' } : null,
    );
    const created = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody(),
      auth: false,
      headers: { 'x-user': 'u1' },
    });
    expect(created.status).toBe(201);
    expect((await h.store.load(created.json.id))?.workspaceId).toBe('ws_a');
    const anonymous = await h.call('GET', `/v1/envelopes/${created.json.id}`, { auth: false });
    expect(anonymous.status).toBe(401);
  });

  it('falls back to configured keys when it returns null', async () => {
    const h = harness({ authenticate: async () => null });
    expect((await h.call('POST', '/v1/envelopes', { body: envelopeBody() })).status).toBe(201);
  });

  it('can refuse outright', async () => {
    const h = harness({
      authenticate: async () => {
        throw new HttpError('UNAUTHORIZED', 'Session expired');
      },
    });
    const res = await h.call('GET', '/v1/envelopes');
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe('Session expired');
  });

  it('lets a read-only principal read but not write', async () => {
    let readOnly = false;
    const h = withHook(async () => ({ id: 'viewer', workspaceId: 'ws_a', readOnly }));
    const { json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody(), auth: false });
    readOnly = true;
    expect((await h.call('GET', `/v1/envelopes/${json.id}`, { auth: false })).status).toBe(200);
    expect((await h.call('GET', '/v1/envelopes', { auth: false })).status).toBe(200);
    for (const [method, path] of [
      ['POST', '/v1/envelopes'],
      ['PATCH', `/v1/envelopes/${json.id}`],
      ['POST', `/v1/envelopes/${json.id}/send`],
      ['POST', `/v1/envelopes/${json.id}/void`],
    ] as const) {
      const res = await h.call(method, path, { body: {}, auth: false });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json.error.code).toBe('FORBIDDEN');
    }
    expect((await h.store.load(json.id))?.envelope.status).toBe('draft');
  });

  it('refuses a principal without a workspace', async () => {
    const h = withHook(async () => ({ id: 'x', workspaceId: '' }));
    expect((await h.call('GET', '/v1/envelopes', { auth: false })).status).toBe(401);
  });
});

describe('basePath', () => {
  it('serves every route and cookie under the prefix', async () => {
    const h = harness({ basePath: '/api/' });
    const call = (method: string, path: string, init: { body?: unknown; key?: boolean } = {}) =>
      h.call(method, path, {
        ...(init.body !== undefined ? { body: init.body } : {}),
        headers: init.key === false ? {} : auth(API_KEY),
      });
    expect((await call('POST', '/v1/envelopes', { body: envelopeBody() })).status).toBe(404);
    const created = await call('POST', '/api/v1/envelopes', {
      body: envelopeBody({ send: true }),
    });
    expect(created.status).toBe(201);
    expect(created.res.headers.get('cache-control')).toBe('no-store');

    const token = h.tokenFor('asha@example.com');
    const mail = h.mailer.sent.find((m) => m.to === 'asha@example.com');
    expect(mail?.text).toContain(`https://sign.example.com/api/sign/${token}`);
    const link = await call('GET', `/api/sign/${token}`, { key: false });
    expect(link.status).toBe(303);
    expect(link.res.headers.get('set-cookie')).toMatch(/Path=\/api\/v1\/sign/);

    const view = await call('GET', `/api/v1/sign/${token}`, { key: false });
    expect(view.status).toBe(200);
    expect((await call('GET', '/api/health', { key: false })).json).toEqual({ ok: true });
  });

  it('refuses a prefix that is not a plain path', () => {
    expect(() => harness({ basePath: 'api' })).toThrow(/basePath/);
    expect(() => harness({ basePath: '/a b' })).toThrow(/basePath/);
  });
});
