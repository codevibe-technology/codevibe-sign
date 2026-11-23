import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import type { TemplateDefinition } from '@/lib/templates';

const WORKSPACE = { id: 'ws_1', slug: 'acme', name: 'Acme' };
const A4 = { width: 595, height: 842 };
const definition: TemplateDefinition = {
  title: '',
  message: '',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 2,
  roles: [
    { id: 'r_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
    { id: 'r_hr', name: 'HR', type: 'signer', auth: 'email_link' },
  ],
  documents: [{ id: 'd1', name: 'offer.pdf', size: 1, sha256: 'a'.repeat(64), pages: [A4] }],
  fields: ['r_emp', 'r_hr'].map((recipientId, i) => ({
    id: `f${i}`,
    documentId: 'd1',
    recipientId,
    type: 'signature' as const,
    page: 0,
    rect: { x: 72 + i * 200, y: 600, width: 150, height: 40 },
    required: true,
  })),
};

const state = vi.hoisted(() => ({
  role: 'member' as Role | null,
  archived: null as Date | null,
  calls: [] as { name: string; args: unknown[] }[],
  webhook: { id: 'wh_1', url: 'https://hooks.example.com/x', enabled: true } as {
    id: string;
    url: string;
    enabled: boolean;
  } | null,
}));

const record =
  (name: string, value?: unknown) =>
  async (...args: unknown[]) => {
    state.calls.push({ name, args });
    return value;
  };

vi.mock('../auth/session', () => ({
  getSessionUser: async () => ({ id: 'u_1', name: 'Asha', email: 'asha@example.com', image: null }),
}));
vi.mock('../db', () => ({ db: () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('../runtime', () => ({ appRuntime: () => ({ files: {} }) }));
vi.mock('../pdf', () => ({ inspectUpload: async () => ({ pageCount: 1, pages: [A4] }) }));
vi.mock('../sign/client', () => ({ signRequest: vi.fn() }));
vi.mock('../workspaces', () => ({
  findMembership: async (_sql: unknown, _user: string, by: { id: string }) =>
    state.role && by.id === WORKSPACE.id ? { workspace: WORKSPACE, role: state.role } : null,
}));
vi.mock('../templates', async (original) => ({
  ...(await original<typeof import('../templates')>()),
  requireTemplate: async () => ({
    id: 'tpl_1',
    workspaceId: WORKSPACE.id,
    name: 'Offer',
    description: null,
    definition,
    archivedAt: state.archived,
  }),
  createTemplate: record('createTemplate', { id: 'tpl_new' }),
  stageDocument: record('stageDocument', 'staged/ws_1/key.pdf'),
}));
vi.mock('../template-send', async (original) => ({
  ...(await original<typeof import('../template-send')>()),
  sendFromTemplate: record('sendFromTemplate', { id: 'env_1' }),
}));
vi.mock('../bulk-sends', () => ({
  createBulkSend: record('createBulkSend', 'bulk_1'),
  getBulkSend: async () => null,
  listBulkRows: async () => [],
  cancelBulkSend: record('cancelBulkSend'),
}));
vi.mock('../bulk-worker', () => ({ processBulkSend: record('processBulkSend') }));
vi.mock('../webhooks', () => ({
  createWebhook: record('createWebhook', { id: 'wh_1', secret: 'whsec_x' }),
  getWebhook: async () => state.webhook,
  getDelivery: async () => ({ deliveryId: 'd_1', body: '{}' }),
  updateWebhook: record('updateWebhook'),
  setWebhookEnabled: record('setWebhookEnabled'),
  rollWebhookSecret: record('rollWebhookSecret', 'whsec_new'),
  deleteWebhook: record('deleteWebhook'),
  assertWebhooksLive: async () => undefined,
}));
vi.mock('../sign/webhooks', () => ({ webhookRules: () => ({}) }));
vi.mock('../sign/server', () => ({
  signServer: () => ({
    sendTestWebhook: record('sendTestWebhook', { outcome: 'delivered', status: 204, error: null }),
    redeliverWebhook: record('redeliverWebhook', { outcome: 'failed', status: 500, error: 'x' }),
  }),
}));

const templates = await import('./templates');
const webhooks = await import('./webhooks');
const called = (name: string) => state.calls.filter((c) => c.name === name);

const people = {
  r_emp: { name: 'Ravi', email: 'ravi@example.com', phone: '' },
  r_hr: { name: 'Meera', email: 'hr@example.com', phone: '' },
};
const definitionInput = {
  name: 'Offer',
  description: '',
  title: '',
  message: '',
  routing: 'sequential' as const,
  expiresInDays: 14,
  remindEveryDays: 2,
  roles: definition.roles,
  fields: definition.fields,
};

beforeEach(() => {
  state.role = 'member';
  state.archived = null;
  state.calls = [];
  state.webhook = { id: 'wh_1', url: 'https://hooks.example.com/x', enabled: true };
});

describe('template actions', () => {
  it('lets members create templates and keeps viewers out', async () => {
    const input = { workspaceId: 'ws_1', definition: definitionInput, documents: [] };
    expect(await templates.createTemplateAction(input)).toEqual({
      ok: true,
      data: { id: 'tpl_new' },
    });
    state.role = 'viewer';
    expect(await templates.createTemplateAction(input)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(called('createTemplate')).toHaveLength(1);
    state.role = null;
    expect(await templates.createTemplateAction(input)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('checks the people before sending and names the field', async () => {
    const result = await templates.sendTemplateAction({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      people: { r_emp: people.r_emp },
      title: 'Offer',
      message: '',
    });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', field: 'people.r_hr.name' });
    expect(called('sendFromTemplate')).toHaveLength(0);

    const sent = await templates.sendTemplateAction({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      people,
      title: 'Offer',
      message: '',
    });
    expect(sent).toEqual({ ok: true, data: { envelopeId: 'env_1' } });
    expect(called('sendFromTemplate')[0]!.args[1]).toMatchObject({
      userId: 'u_1',
      people,
      title: 'Offer',
    });
  });

  it('does not send from an archived template', async () => {
    state.archived = new Date();
    const result = await templates.sendTemplateAction({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      people,
      title: 'Offer',
      message: '',
    });
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('reads the CSV again on the server and needs consent to skip bad rows', async () => {
    const csv = 'Employee name,Employee email\nRavi,ravi@example.com\nMia,nope\n';
    const base = { workspaceId: 'ws_1', templateId: 'tpl_1', csv, fixed: { r_hr: people.r_hr } };
    expect(await templates.startBulkSendAction({ ...base, skipProblems: false })).toMatchObject({
      ok: false,
      field: 'csv',
      error: expect.stringMatching(/1 row has problems/),
    });
    expect(
      await templates.startBulkSendAction({ ...base, fixed: {}, skipProblems: true }),
    ).toMatchObject({ ok: false, field: 'people.r_hr.name' });
    const started = await templates.startBulkSendAction({ ...base, skipProblems: true });
    expect(started).toEqual({ ok: true, data: { bulkId: 'bulk_1', count: 1 } });
    const [created] = called('createBulkSend');
    expect((created!.args[1] as { rows: unknown[] }).rows).toEqual([
      {
        line: 2,
        people: {
          r_emp: { name: 'Ravi', email: 'ravi@example.com', phone: '' },
          r_hr: people.r_hr,
        },
        metadata: {},
      },
    ]);
    expect(called('processBulkSend')).toHaveLength(1);

    const blocked = await templates.startBulkSendAction({
      ...base,
      csv: 'Salary\n1\n',
      skipProblems: true,
    });
    expect(blocked).toMatchObject({ ok: false, field: 'csv' });
  });
});

describe('webhook actions', () => {
  it('are for admins only', async () => {
    const input = {
      workspaceId: 'ws_1',
      url: 'https://hooks.example.com/x',
      description: '',
      events: ['*'],
    };
    expect(await webhooks.createWebhookAction(input)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    state.role = 'admin';
    expect(await webhooks.createWebhookAction(input)).toEqual({
      ok: true,
      data: { id: 'wh_1', secret: 'whsec_x' },
    });
  });

  it('tests and redelivers only to an endpoint that is on', async () => {
    state.role = 'admin';
    expect(await webhooks.testWebhookAction({ workspaceId: 'ws_1', webhookId: 'wh_1' })).toEqual({
      ok: true,
      data: { outcome: 'delivered', status: 204, error: null },
    });
    expect(called('sendTestWebhook')[0]!.args[0]).toEqual({
      workspaceId: 'ws_1',
      url: 'https://hooks.example.com/x',
    });
    expect(
      await webhooks.retryDeliveryAction({
        workspaceId: 'ws_1',
        webhookId: 'wh_1',
        deliveryId: 'd_1',
      }),
    ).toMatchObject({ ok: true, data: { outcome: 'failed', status: 500 } });
    expect(called('redeliverWebhook')[0]!.args[0]).toEqual({
      workspaceId: 'ws_1',
      url: 'https://hooks.example.com/x',
      deliveryId: 'd_1',
      body: '{}',
    });

    state.webhook = { ...state.webhook!, enabled: false };
    expect(
      await webhooks.testWebhookAction({ workspaceId: 'ws_1', webhookId: 'wh_1' }),
    ).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    state.webhook = null;
    expect(
      await webhooks.retryDeliveryAction({
        workspaceId: 'ws_1',
        webhookId: 'wh_1',
        deliveryId: 'd_1',
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
