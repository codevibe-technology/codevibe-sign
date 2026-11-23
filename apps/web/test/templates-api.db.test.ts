import { randomUUID } from 'node:crypto';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  postgresStore,
  type PdfEngine,
  type SignServer,
} from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBulkSend } from '@/server/bulk-sends';
import { migrateAll } from '@/server/migrate';
import { usageOf } from '@/server/plans';
import { createPlanGate } from '@/server/sign/plan-gate';
import { appTemplateStore } from '@/server/sign/templates';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  setTemplateArchived,
  stageDocument,
  templateFileKey,
  updateTemplate,
  type DefinitionInput,
} from '@/server/templates';
import { createWorkspace } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const A4 = { width: 595, height: 842 };
const pdf = new TextEncoder().encode('%PDF-1.7 template');
const base64 = Buffer.from(pdf).toString('base64');

const engine: PdfEngine = {
  inspectPdf: async () => ({ pageCount: 1, pages: [A4] }),
  renderFields: async (bytes) => bytes,
  appendCertificate: async (bytes) => bytes,
  seal: async (bytes) => bytes,
};

const editorDefinition = (overrides: Partial<DefinitionInput> = {}): DefinitionInput => ({
  name: 'Offer letter',
  description: 'For new joiners',
  title: '',
  message: 'Welcome aboard',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 2,
  roles: [
    { id: 'role_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
    { id: 'role_hr', name: 'HR', type: 'viewer', auth: 'email_link' },
  ],
  fields: [
    {
      id: 'f1',
      documentId: 'doc_1',
      recipientId: 'role_emp',
      type: 'signature',
      page: 0,
      rect: { x: 72, y: 600, width: 180, height: 48 },
      required: true,
    },
  ],
  ...overrides,
});

const apiTemplate = (overrides: Record<string, unknown> = {}) => ({
  name: 'NDA',
  documents: [{ key: 'nda', name: 'nda.pdf', content: base64 }],
  roles: [{ key: 'party', name: 'Other party', auth: 'email_link' }],
  fields: [{ role: 'party', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 }],
  reminders: { firstAfterDays: 1, everyDays: 4, max: 2 },
  ...overrides,
});

describe.skipIf(!url)('the dashboard’s templates through the sign API', () => {
  const schema = `web_tpl_api_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let sign: SignServer;
  let userId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  const files = memoryFileStore();

  async function call(method: string, path: string, body?: unknown, workspace = workspaceId) {
    const res = await sign.app.request(path, {
      method,
      headers: { 'x-test-workspace': workspace, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // Answers are checked field by field; a loose type keeps the tests readable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  }

  async function fromEditor(overrides: Partial<DefinitionInput> = {}, workspace = workspaceId) {
    const stagedKey = await stageDocument(files, workspace, pdf);
    return createTemplate(sql, files, {
      workspaceId: workspace,
      createdBy: userId,
      definition: editorDefinition(overrides),
      documents: [{ id: 'doc_1', name: 'offer.pdf', stagedKey, pages: [A4] }],
      inspect: async () => ({ pages: [A4] }),
    });
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    await migrateAll(sql);
    userId = randomUUID();
    await sql`insert into auth_users (id, name, email) values (${userId}, 'Asha', ${`asha-${userId.slice(0, 6)}@example.com`})`;
    workspaceId = (await createWorkspace(sql, { name: 'Acme', userId })).id;
    otherWorkspaceId = (await createWorkspace(sql, { name: 'Other', userId })).id;
    sign = createSignServer({
      store: postgresStore(sql),
      templateStore: appTemplateStore(sql, files),
      files,
      mailer: consoleMailer({ silent: true }),
      otp: consoleOtpSender({ silent: true }),
      pdf: engine,
      sealer: { p12: new Uint8Array([1]), passphrase: 'unused' },
      apiKeys: [],
      authenticate: async (request) => {
        const workspace = request.headers.get('x-test-workspace');
        return workspace ? { id: 'key_1', workspaceId: workspace } : null;
      },
      publicUrl: 'http://localhost:3000',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  it('shows a template saved in the editor to an API key, in its workspace only', async () => {
    const saved = await fromEditor();
    const got = await call('GET', `/v1/templates/${saved.id}`);
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({
      id: saved.id,
      name: 'Offer letter',
      description: 'For new joiners',
      title: 'Offer letter',
      message: 'Welcome aboard',
      routing: 'sequential',
      expiresInDays: 14,
      reminders: { firstAfterDays: 2, everyDays: 2, max: 5 },
      roles: [
        { id: 'role_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
        { id: 'role_hr', name: 'HR', type: 'viewer', auth: 'email_link' },
      ],
      documents: [{ id: 'doc_1', name: 'offer.pdf', size: pdf.length, pageCount: 1 }],
      fields: [{ id: 'f1', documentId: 'doc_1', roleId: 'role_emp', type: 'signature' }],
    });
    expect(JSON.stringify(got.json)).not.toMatch(/templates\/|staged\/|createdBy|workspace/i);

    const listed = await call('GET', '/v1/templates?q=offer');
    expect(listed.json.templates.map((t: { id: string }) => t.id)).toContain(saved.id);

    const elsewhere = await call('GET', `/v1/templates/${saved.id}`, undefined, otherWorkspaceId);
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.json).toEqual((await call('GET', '/v1/templates/tpl_nope')).json);
    const theirs = await call('GET', '/v1/templates', undefined, otherWorkspaceId);
    expect(theirs.json.templates).toEqual([]);
  });

  it('hides archived templates from the API', async () => {
    const saved = await fromEditor({ name: 'Archived one' });
    await setTemplateArchived(sql, workspaceId, saved.id, true);
    for (const [method, path, body] of [
      ['GET', `/v1/templates/${saved.id}`],
      ['PATCH', `/v1/templates/${saved.id}`, { name: 'Back' }],
      ['DELETE', `/v1/templates/${saved.id}`],
      ['POST', `/v1/templates/${saved.id}/envelopes`, { roles: {} }],
    ] as const) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(404);
    }
    const listed = await call('GET', '/v1/templates?q=archived');
    expect(listed.json.templates).toEqual([]);
    expect((await getTemplate(sql, workspaceId, saved.id))?.name).toBe('Archived one');
  });

  it('saves a template created with a key where the editor finds it', async () => {
    const created = await call('POST', '/v1/templates', apiTemplate());
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const record = (await getTemplate(sql, workspaceId, created.json.id))!;
    expect(record).toMatchObject({ name: 'NDA', createdBy: null, archivedAt: null });
    expect(record.definition).toMatchObject({
      title: '',
      message: '',
      remindEveryDays: 4,
      reminders: { firstAfterDays: 1, everyDays: 4, max: 2 },
      roles: [{ id: created.json.roles[0].id, name: 'Other party', type: 'signer' }],
      fields: [{ recipientId: created.json.roles[0].id, documentId: created.json.documents[0].id }],
    });
    const key = templateFileKey(workspaceId, record.id, created.json.documents[0].id);
    expect(await files.get(key)).toEqual(pdf);
    expect((await listTemplates(sql, workspaceId)).map((t) => t.id)).toContain(record.id);
    expect((await call('GET', `/v1/templates/${record.id}`)).json.reminders).toEqual({
      firstAfterDays: 1,
      everyDays: 4,
      max: 2,
    });

    const aadhaar = await call(
      'POST',
      '/v1/templates',
      apiTemplate({ roles: [{ key: 'party', name: 'Other party', auth: 'aadhaar' }] }),
    );
    expect(aadhaar.status).toBe(400);
  });

  it('changes a template from either side without losing the other’s save', async () => {
    const saved = await fromEditor({ name: 'Policy' });
    const patched = await call('PATCH', `/v1/templates/${saved.id}`, {
      name: 'Policy 2026',
      message: null,
      expiresInDays: 7,
    });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    const record = (await getTemplate(sql, workspaceId, saved.id))!;
    expect(record.name).toBe('Policy 2026');
    expect(record.definition).toMatchObject({ message: '', expiresInDays: 7, remindEveryDays: 2 });
    expect(record.definition.fields).toHaveLength(1);

    await updateTemplate(sql, workspaceId, saved.id, editorDefinition({ name: 'Policy 2027' }));
    const again = await call('PATCH', `/v1/templates/${saved.id}`, { expiresInDays: 9 });
    expect(again.json).toMatchObject({ name: 'Policy 2027', expiresInDays: 9 });

    const foreign = await call(
      'PATCH',
      `/v1/templates/${saved.id}`,
      { name: 'x' },
      otherWorkspaceId,
    );
    expect(foreign.status).toBe(404);
  });

  it('pages through the active templates newest first', async () => {
    const ws = (await createWorkspace(sql, { name: 'Paging', userId })).id;
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) ids.push((await fromEditor({ name }, ws)).id);
    const first = await call('GET', '/v1/templates?limit=2', undefined, ws);
    expect(first.json.templates.map((t: { id: string }) => t.id)).toEqual([ids[2], ids[1]]);
    const second = await call(
      'GET',
      `/v1/templates?limit=2&cursor=${first.json.nextCursor}`,
      undefined,
      ws,
    );
    expect(second.json.templates.map((t: { id: string }) => t.id)).toEqual([ids[0]]);
    expect(second.json.nextCursor).toBeNull();
    expect((await call('GET', '/v1/templates?cursor=junk', undefined, ws)).status).toBe(400);
  });

  it('makes an envelope from an editor template the way the dashboard sends it', async () => {
    const saved = await fromEditor({ name: 'Joining letter', routing: 'parallel' });
    const roles = {
      role_emp: { name: 'Ravi Kumar', email: 'RAVI@example.com' },
      HR: { name: 'HR desk', email: 'hr@example.com' },
    };
    const created = await call('POST', `/v1/templates/${saved.id}/envelopes`, {
      roles,
      metadata: { ref: 'R1' },
      send: true,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json).toMatchObject({
      title: 'Joining letter',
      message: 'Welcome aboard',
      status: 'sent',
      routing: 'parallel',
      reminders: { firstAfterDays: 2, everyDays: 2, max: 5 },
      metadata: { ref: 'R1', templateId: saved.id },
      recipients: [
        { name: 'Ravi Kumar', email: 'ravi@example.com', role: 'signer', auth: 'email_link' },
        { name: 'HR desk', role: 'viewer' },
      ],
    });
    expect(created.json.fields).toHaveLength(1);
    const days = (Date.parse(created.json.expiresAt) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(14);

    const foreign = await call(
      'POST',
      `/v1/templates/${saved.id}/envelopes`,
      { roles, send: true },
      otherWorkspaceId,
    );
    expect(foreign.status).toBe(404);
  });

  it('deletes a template and its files, but not under a running bulk send', async () => {
    const saved = await fromEditor({ name: 'To delete' });
    const key = templateFileKey(workspaceId, saved.id, 'doc_1');
    await createBulkSend(sql, {
      workspaceId,
      templateId: saved.id,
      templateName: saved.name,
      createdBy: userId,
      rows: [{ line: 2, people: {}, metadata: {} }],
    });
    const busy = await call('DELETE', `/v1/templates/${saved.id}`);
    expect(busy.status).toBe(409);
    expect(await files.get(key)).not.toBeNull();

    await sql`update app_bulk_sends set status = 'done' where template_id = ${saved.id}`;
    expect(
      (await call('DELETE', `/v1/templates/${saved.id}`, undefined, otherWorkspaceId)).status,
    ).toBe(404);
    expect((await call('DELETE', `/v1/templates/${saved.id}`)).json).toEqual({
      id: saved.id,
      deleted: true,
    });
    expect(await getTemplate(sql, workspaceId, saved.id)).toBeNull();
    expect(await files.get(key)).toBeNull();
  });

  it('keeps API templates and their envelopes within the workspace’s plan', async () => {
    vi.stubEnv('PLAN_MODE', 'hosted');
    vi.stubEnv('FREE_PLAN_LIMITS', JSON.stringify({ activeTemplates: 1, envelopesPerMonth: 1 }));
    const ws = (await createWorkspace(sql, { name: 'Free', userId })).id;
    const first = await call('POST', '/v1/templates', apiTemplate(), ws);
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    expect(await usageOf(sql, ws, 'storage_bytes')).toBe(pdf.length);

    const second = await call('POST', '/v1/templates', apiTemplate({ name: 'Second' }), ws);
    expect(second.status).toBe(403);
    expect(second.json.error).toMatchObject({
      code: 'FORBIDDEN',
      details: { limit: 'activeTemplates', max: 1, plan: 'free' },
    });
    expect((await listTemplates(sql, ws)).map((t) => t.name)).toEqual(['NDA']);

    const gate = createPlanGate({
      sql,
      settings: () => ({ mode: 'hosted', freeOverrides: { envelopesPerMonth: 1 } }),
      authenticate: async (request) => ({
        id: 'user:u1',
        workspaceId: request.headers.get('x-test-workspace')!,
      }),
      templateSizes: async (workspaceId, templateId) =>
        (await getTemplate(sql, workspaceId, templateId))?.definition.documents.map(
          (d) => d.size,
        ) ?? null,
      basePath: '',
      maxBodyBytes: 1 << 20,
    });
    const send = (send: boolean) =>
      gate(
        new Request(`http://localhost:3000/v1/templates/${first.json.id}/envelopes`, {
          method: 'POST',
          headers: { 'x-test-workspace': ws, 'content-type': 'application/json' },
          body: JSON.stringify({
            roles: { 'Other party': { name: 'Zed', email: 'zed@example.com' } },
            send,
          }),
        }),
        async (request) => sign.app.fetch(request),
      );
    expect((await send(false)).status).toBe(201);
    expect(await usageOf(sql, ws, 'envelopes_sent')).toBe(0);
    expect(await usageOf(sql, ws, 'storage_bytes')).toBe(pdf.length * 2);
    expect((await send(true)).status).toBe(201);
    expect(await usageOf(sql, ws, 'envelopes_sent')).toBe(1);
    const over = await send(true);
    expect(over.status).toBe(403);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('PLAN_LIMIT');
    expect(await usageOf(sql, ws, 'storage_bytes')).toBe(pdf.length * 3);
  });
});
