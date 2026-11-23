import { describe, expect, it } from 'vitest';
import { memoryFileStore } from '../adapters/files';
import { API_KEY, harness, pdfBase64, templateBody } from '../testing/harness';
import { templateFileKey } from '../template';

const KEY_A = 'workspace-a-key-0123456789';
const KEY_B = 'workspace-b-key-0123456789';
const auth = (key: string) => ({ authorization: `Bearer ${key}` });

function tenants() {
  return harness({
    apiKeys: [
      API_KEY,
      { id: 'a', key: KEY_A, workspaceId: 'ws_a' },
      { id: 'b', key: KEY_B, workspaceId: 'ws_b' },
    ],
  });
}

async function createTemplate(h: ReturnType<typeof harness>, body = templateBody(), key = API_KEY) {
  const created = await h.call('POST', '/v1/templates', { body, headers: auth(key) });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  return created.json as {
    id: string;
    updatedAt: string;
    roles: { id: string; name: string }[];
    documents: { id: string }[];
    fields: { id: string; roleId: string; label?: string }[];
  };
}

const people = {
  Employee: { name: 'Asha Rao', email: 'asha@example.com' },
  HR: { name: 'HR Team', email: 'hr@example.com' },
};

describe('templates', () => {
  it('creates a template and answers without file locations', async () => {
    const h = harness();
    const created = await h.call('POST', '/v1/templates', { body: templateBody() });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      name: 'Offer letter',
      title: 'Offer letter',
      routing: 'sequential',
      expiresInDays: 30,
      roles: [
        { name: 'Employee', type: 'signer', auth: 'email_link' },
        { name: 'HR', type: 'viewer', auth: 'email_link' },
      ],
      documents: [{ name: 'offer.pdf', pageCount: 2 }],
    });
    expect(created.json.fields).toHaveLength(2);
    expect(created.json.fields[0].roleId).toBe(created.json.roles[0].id);
    expect(JSON.stringify(created.json)).not.toMatch(/fileKey|templates\//);
    const key = templateFileKey('default', created.json.id, created.json.documents[0].id);
    expect(await h.files.get(key)).not.toBeNull();
  });

  it('takes the PDFs as a multipart upload', async () => {
    const h = harness();
    const { documents, ...rest } = templateBody();
    const form = new FormData();
    form.set('template', JSON.stringify({ ...rest, documents: [{ key: 'offer' }] }));
    form.append(
      'documents',
      new Blob([Buffer.from(documents[0]!.content, 'base64')], { type: 'application/pdf' }),
      'upload.pdf',
    );
    const created = await h.call('POST', '/v1/templates', { body: form });
    expect(created.status).toBe(201);
    expect(created.json.documents[0].name).toBe('upload.pdf');
  });

  it('refuses a template that could never be sent', async () => {
    const kept = new Set<string>();
    const memory = memoryFileStore();
    const h = harness({
      files: {
        ...memory,
        put: async (key, bytes, type) => {
          kept.add(key);
          await memory.put(key, bytes, type);
        },
        delete: async (key) => {
          kept.delete(key);
          await memory.delete(key);
        },
      },
    });
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ name: '' }, /name is required/],
      [{ roles: [] }, /roles must be a list/],
      [{ roles: [{ name: 'HR', type: 'viewer' }], fields: [] }, /signer or an approver/],
      [{ roles: [{ name: 'A' }, { name: ' a ' }], fields: [] }, /already the name/],
      [
        { fields: [{ role: 'nobody', page: 0, x: 1, y: 1, width: 10, height: 10 }] },
        /role does not match/,
      ],
      [
        { fields: [{ role: 'hr', page: 0, x: 1, y: 1, width: 10, height: 10 }] },
        /viewers fill in nothing/,
      ],
      [
        { fields: [{ role: 'employee', page: 2, x: 1, y: 1, width: 10, height: 10 }] },
        /not a page/,
      ],
      [
        { fields: [{ role: 'employee', page: 0, x: 600, y: 1, width: 100, height: 10 }] },
        /does not fit/,
      ],
      [{ documents: [{ name: 'x.pdf', content: Buffer.from('nope').toString('base64') }] }, /PDF/],
    ];
    for (const [overrides, message] of cases) {
      const res = await h.call('POST', '/v1/templates', { body: templateBody(overrides) });
      expect(res.status, JSON.stringify(overrides)).toBeGreaterThanOrEqual(400);
      expect(res.json.error.message).toMatch(message);
    }
    expect((await h.call('GET', '/v1/templates')).json.templates).toEqual([]);
    expect([...kept]).toEqual([]);
  });

  it('lists newest first, page by page, with search', async () => {
    const h = harness();
    const ids: string[] = [];
    for (const name of ['NDA', 'Offer letter', 'Policy 100%']) {
      ids.push((await createTemplate(h, templateBody({ name }))).id);
      h.advance(1000);
    }
    const first = await h.call('GET', '/v1/templates?limit=2');
    expect(first.json.templates.map((t: { id: string }) => t.id)).toEqual([ids[2], ids[1]]);
    expect(first.json.templates[0]).toMatchObject({
      name: 'Policy 100%',
      documentCount: 1,
      pageCount: 2,
      roles: [
        { name: 'Employee', type: 'signer' },
        { name: 'HR', type: 'viewer' },
      ],
    });
    const second = await h.call('GET', `/v1/templates?limit=2&cursor=${first.json.nextCursor}`);
    expect(second.json.templates.map((t: { id: string }) => t.id)).toEqual([ids[0]]);
    expect(second.json.nextCursor).toBeNull();
    const found = await h.call('GET', '/v1/templates?q=100%25');
    expect(found.json.templates.map((t: { id: string }) => t.id)).toEqual([ids[2]]);
    expect((await h.call('GET', '/v1/templates?limit=500')).status).toBe(400);
    expect((await h.call('GET', '/v1/templates?cursor=nonsense')).status).toBe(400);
  });

  it('updates settings, roles and fields, and keeps a role sent with its id', async () => {
    const h = harness();
    const template = await createTemplate(h);
    const [employee, hr] = template.roles;
    h.advance(1000);

    const renamed = await h.call('PATCH', `/v1/templates/${template.id}`, {
      body: { name: 'Offer letter 2026', description: null, message: 'Welcome aboard.' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json).toMatchObject({ name: 'Offer letter 2026', message: 'Welcome aboard.' });
    expect(renamed.json.description).toBeUndefined();
    expect(renamed.json.fields).toEqual(template.fields);
    expect(Date.parse(renamed.json.updatedAt)).toBeGreaterThan(Date.parse(template.updatedAt));

    const reworked = await h.call('PATCH', `/v1/templates/${template.id}`, {
      body: {
        roles: [
          { id: employee!.id, name: 'New hire' },
          { key: 'manager', name: 'Manager', type: 'approver' },
        ],
        fields: [
          { role: employee!.id, type: 'signature', page: 0, x: 10, y: 10, width: 100, height: 40 },
        ],
      },
    });
    expect(reworked.status).toBe(200);
    expect(reworked.json.roles.map((r: { id: string }) => r.id)).toContain(employee!.id);
    expect(reworked.json.roles.map((r: { id: string }) => r.id)).not.toContain(hr!.id);
    expect(reworked.json.fields).toHaveLength(1);

    const orphaned = await h.call('PATCH', `/v1/templates/${template.id}`, {
      body: { roles: [{ name: 'Someone else' }] },
    });
    expect(orphaned.status).toBe(400);
    expect(orphaned.json.error.message).toMatch(/send fields with the roles/);

    const files = await h.call('PATCH', `/v1/templates/${template.id}`, {
      body: { documents: [{ name: 'other.pdf', content: pdfBase64() }] },
    });
    expect(files.status).toBe(400);
    expect((await h.call('PATCH', '/v1/templates/missing', { body: {} })).status).toBe(404);
  });

  it('deletes a template and its files', async () => {
    const h = harness();
    const template = await createTemplate(h);
    const key = templateFileKey('default', template.id, template.documents[0]!.id);
    const gone = await h.call('DELETE', `/v1/templates/${template.id}`);
    expect(gone.json).toEqual({ id: template.id, deleted: true });
    expect(await h.files.get(key)).toBeNull();
    expect((await h.call('GET', `/v1/templates/${template.id}`)).status).toBe(404);
    expect((await h.call('DELETE', `/v1/templates/${template.id}`)).status).toBe(404);
  });

  it('needs an API key, and lets a read-only credential only read', async () => {
    const h = harness({
      authenticate: async (request) =>
        request.headers.get('x-viewer')
          ? { id: 'viewer', workspaceId: 'default', readOnly: true }
          : null,
    });
    const template = await createTemplate(h);
    for (const [method, path] of [
      ['GET', '/v1/templates'],
      ['POST', '/v1/templates'],
      ['GET', `/v1/templates/${template.id}`],
      ['PATCH', `/v1/templates/${template.id}`],
      ['DELETE', `/v1/templates/${template.id}`],
      ['POST', `/v1/templates/${template.id}/envelopes`],
    ] as const) {
      const body = method === 'GET' ? undefined : {};
      const anonymous = await h.call(method, path, { auth: false, body });
      expect(anonymous.status, `${method} ${path}`).toBe(401);
      const wrong = await h.call(method, path, { headers: auth('not-a-real-key-000000'), body });
      expect(wrong.status, `${method} ${path}`).toBe(401);
      const viewer = await h.call(method, path, {
        auth: false,
        headers: { 'x-viewer': '1' },
        body,
      });
      expect(viewer.status, `${method} ${path}`).toBe(method === 'GET' ? 200 : 403);
    }
  });

  it('hides one workspace’s templates from another as if they did not exist', async () => {
    const h = tenants();
    const template = await createTemplate(h, templateBody(), KEY_A);
    const attempts: [string, string, unknown?][] = [
      ['GET', `/v1/templates/${template.id}`],
      ['PATCH', `/v1/templates/${template.id}`, { name: 'Taken over' }],
      ['DELETE', `/v1/templates/${template.id}`],
      ['POST', `/v1/templates/${template.id}/envelopes`, { roles: people, send: true }],
    ];
    for (const key of [KEY_B, API_KEY]) {
      for (const [method, path, body] of attempts) {
        const res = await h.call(method, path, { body, headers: auth(key) });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.json).toEqual(
          (await h.call(method, path.replace(template.id, 'nope'), { body, headers: auth(key) }))
            .json,
        );
      }
      const listed = await h.call('GET', '/v1/templates', { headers: auth(key) });
      expect(listed.json.templates).toEqual([]);
    }
    const own = await h.call('GET', `/v1/templates/${template.id}`, { headers: auth(KEY_A) });
    expect(own.json.name).toBe('Offer letter');
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('replays a create with the same Idempotency-Key instead of creating twice', async () => {
    const h = harness();
    const headers = { 'idempotency-key': 'tpl-1' };
    const first = await h.call('POST', '/v1/templates', { body: templateBody(), headers });
    const again = await h.call('POST', '/v1/templates', { body: templateBody(), headers });
    expect(again.status).toBe(201);
    expect(again.res.headers.get('idempotent-replayed')).toBe('true');
    expect(again.json.id).toBe(first.json.id);
    expect((await h.call('GET', '/v1/templates')).json.templates).toHaveLength(1);
    const other = await h.call('POST', '/v1/templates', {
      body: templateBody({ name: 'Different' }),
      headers,
    });
    expect(other.status).toBe(400);
  });

  it('limits how many templates a key creates in a minute', async () => {
    const h = harness({ limits: { envelopesPerMinute: 1 } });
    await createTemplate(h);
    const limited = await h.call('POST', '/v1/templates', { body: templateBody() });
    expect(limited.status).toBe(429);
    expect(Number(limited.res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('says so when the store keeps no templates', async () => {
    const h = harness();
    delete h.store.templateStore;
    const bare = harness({ store: h.store });
    const res = await bare.call('GET', '/v1/templates');
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('INVALID_STATE');
  });
});

describe('an envelope from a template', () => {
  it('fills the roles, prefills by label and sends', async () => {
    const h = harness();
    const template = await createTemplate(h);
    const created = await h.call('POST', `/v1/templates/${template.id}/envelopes`, {
      body: {
        roles: people,
        prefill: { 'employee code': 'E-1042' },
        metadata: { employeeId: 'E-1042' },
        send: true,
      },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const envelope = created.json;
    expect(envelope).toMatchObject({
      title: 'Offer letter',
      status: 'sent',
      routing: 'sequential',
      metadata: { employeeId: 'E-1042', templateId: template.id },
      recipients: [
        { name: 'Asha Rao', email: 'asha@example.com', role: 'signer', order: 1 },
        { name: 'HR Team', email: 'hr@example.com', role: 'viewer' },
      ],
    });
    expect(envelope.fields).toHaveLength(2);
    expect(envelope.fields.every((f: { recipientId: string }) => f.recipientId)).toBe(true);
    const text = envelope.fields.find((f: { type: string }) => f.type === 'text');
    expect(envelope.values).toEqual([{ fieldId: text.id, value: 'E-1042' }]);
    expect(JSON.stringify(envelope)).not.toMatch(/fileKey|templates\//);
    expect(h.tokenFor('asha@example.com')).toBeTruthy();

    const file = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${envelope.documents[0].id}`,
    );
    expect(file.res.headers.get('content-type')).toBe('application/pdf');
  });

  it('makes a draft by default, with overrides, keyed by role id', async () => {
    const h = harness();
    const template = await createTemplate(h);
    const [employee, hr] = template.roles;
    const created = await h.call('POST', `/v1/templates/${template.id}/envelopes`, {
      body: {
        roles: {
          [employee!.id]: { name: 'Asha Rao', email: 'ASHA@example.com', auth: 'email_otp' },
          [hr!.id]: people.HR,
        },
        prefill: { [template.fields[1]!.id]: 'E-7' },
        title: 'Offer for Asha',
        message: 'Please sign.',
        expiresInDays: 7,
      },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      status: 'draft',
      title: 'Offer for Asha',
      message: 'Please sign.',
      recipients: [{ email: 'asha@example.com', auth: 'email_otp' }, {}],
    });
    expect(created.json.values).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(0);

    await h.call('PATCH', `/v1/templates/${template.id}`, { body: { message: 'From HR.' } });
    const roles = { [employee!.id]: people.Employee, [hr!.id]: people.HR };
    const at = `/v1/templates/${template.id}/envelopes`;
    expect((await h.call('POST', at, { body: { roles } })).json.message).toBe('From HR.');
    const silent = await h.call('POST', at, { body: { roles, message: null } });
    expect(silent.json.message).toBeUndefined();
  });

  it('points every problem at the role or prefill key it came from', async () => {
    const h = harness();
    const template = await createTemplate(h);
    const at = `/v1/templates/${template.id}/envelopes`;
    const cases: [Record<string, unknown>, string, RegExp][] = [
      [{ roles: { Employee: people.Employee } }, 'roles.HR', /say who the HR is/],
      [{ roles: { ...people, Boss: people.HR } }, 'roles.Boss', /does not match any role/],
      [
        { roles: { ...people, [template.roles[0]!.id]: people.Employee } },
        `roles.${template.roles[0]!.id}`,
        /given twice/,
      ],
      [
        { roles: { ...people, Employee: { name: 'Asha', email: 'not-an-email' } } },
        'roles.Employee.email',
        /roles\.Employee\.email is not a valid email/,
      ],
      [{ roles: { ...people, HR: { email: 'hr@example.com' } } }, 'roles.HR.name', /name/],
      [{ roles: people, prefill: { Salary: '1' } }, 'prefill.Salary', /does not match/],
      [{ roles: people, prefill: { 'Employee code': 7 } }, 'prefill.Employee code', /string/],
      [
        { roles: people, prefill: { [template.fields[0]!.id]: 'x' } },
        `prefill.${template.fields[0]!.id}`,
        /prefilled/,
      ],
      [{ roles: people, send: 'yes' }, 'send', /true or false/],
      [{ roles: people, expiresInDays: 0 }, 'expiresInDays', /expiresInDays/],
    ];
    for (const [body, path, message] of cases) {
      const res = await h.call('POST', at, { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.message).toMatch(message);
      expect(res.json.error.details.issues[0].path, JSON.stringify(body)).toBe(path);
    }
    expect((await h.call('GET', '/v1/envelopes')).json.envelopes).toEqual([]);
  });

  it('refuses when a PDF of the template is gone or was changed in storage', async () => {
    const h = harness();
    const template = await createTemplate(h);
    const key = templateFileKey('default', template.id, template.documents[0]!.id);
    await h.files.put(key, new TextEncoder().encode('%PDF-1.7\npages=9\n'), 'application/pdf');
    const res = await h.call('POST', `/v1/templates/${template.id}/envelopes`, {
      body: { roles: people },
    });
    expect(res.status).toBe(409);
    expect(res.json.error.message).toMatch(/missing from storage/);
    expect(res.json.error.message).not.toContain(key);
  });

  it('shares the envelope rate limit and replays by Idempotency-Key', async () => {
    const h = harness({ limits: { envelopesPerMinute: 2 } });
    const template = await createTemplate(h);
    const at = `/v1/templates/${template.id}/envelopes`;
    const headers = { 'idempotency-key': 'offer-asha' };
    const first = await h.call('POST', at, { body: { roles: people, send: true }, headers });
    const again = await h.call('POST', at, { body: { roles: people, send: true }, headers });
    expect(again.json.id).toBe(first.json.id);
    expect(again.res.headers.get('idempotent-replayed')).toBe('true');
    expect((await h.call('GET', '/v1/envelopes')).json.envelopes).toHaveLength(1);
    expect((await h.call('POST', at, { body: { roles: people } })).status).toBe(201);
    expect((await h.call('POST', at, { body: { roles: people } })).status).toBe(429);
  });
});
