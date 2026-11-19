import { randomUUID } from 'node:crypto';
import { memoryFileStore, type WebhookDeliveryReport } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DefinitionInput } from '@/server/templates';
import {
  cancelBulkSend,
  claimBulkSend,
  createBulkSend,
  getBulkSend,
  listBulkRows,
  listBulkSends,
  openBulkSends,
  runBulkSend,
} from '@/server/bulk-sends';
import { AppError } from '@/server/errors';
import { migrateAll } from '@/server/migrate';
import {
  countTemplates,
  createTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  readTemplateDocument,
  setTemplateArchived,
  stageDocument,
  updateTemplate,
} from '@/server/templates';
import {
  createWebhook,
  deleteWebhook,
  getDelivery,
  getWebhook,
  listDeliveries,
  listWebhooks,
  pruneDeliveries,
  recordDelivery,
  rollWebhookSecret,
  setWebhookEnabled,
  updateWebhook,
  webhookTargetsFor,
} from '@/server/webhooks';
import { createWorkspace } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const A4 = { width: 595, height: 842 };

async function rejectsWith(promise: Promise<unknown>, code: string, field?: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (field) expect((err as AppError).field).toBe(field);
  return err as AppError;
}

const definition = (overrides: Partial<DefinitionInput> = {}): DefinitionInput => ({
  name: 'Offer letter',
  description: 'For new joiners',
  title: '',
  message: 'Welcome aboard',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 2,
  roles: [
    { id: 'role_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
    { id: 'role_hr', name: 'HR', type: 'signer', auth: 'email_otp' },
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
    {
      id: 'f2',
      documentId: 'doc_1',
      recipientId: 'role_hr',
      type: 'signature',
      page: 0,
      rect: { x: 300, y: 600, width: 180, height: 48 },
      required: true,
    },
  ],
  ...overrides,
});

describe.skipIf(!url)('templates, bulk sends and webhooks against PostgreSQL', () => {
  const schema = `web_tpl_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let userId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  const files = memoryFileStore();
  const inspect = async () => ({ pages: [A4] });
  const pdf = new TextEncoder().encode('%PDF-1.7 test');

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    const applied = await migrateAll(sql);
    expect(applied).toContain('app/0004_templates');
    expect(applied).toContain('app/0005_webhooks');
    userId = randomUUID();
    await sql`insert into auth_users (id, name, email) values (${userId}, 'Asha', ${`asha-${userId.slice(0, 6)}@example.com`})`;
    workspaceId = (await createWorkspace(sql, { name: 'Acme', userId })).id;
    otherWorkspaceId = (await createWorkspace(sql, { name: 'Other', userId })).id;
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  async function newTemplate(overrides: Partial<DefinitionInput> = {}) {
    const stagedKey = await stageDocument(files, workspaceId, pdf);
    return createTemplate(sql, files, {
      workspaceId,
      createdBy: userId,
      definition: definition(overrides),
      documents: [{ id: 'doc_1', name: 'offer.pdf', stagedKey, pages: [A4] }],
      inspect,
    });
  }

  describe('templates', () => {
    it('saves a template with its PDF and reads it back in its workspace only', async () => {
      const template = await newTemplate();
      expect(template).toMatchObject({
        name: 'Offer letter',
        description: 'For new joiners',
        createdByName: 'Asha',
        archivedAt: null,
      });
      expect(template.definition.documents).toEqual([
        expect.objectContaining({ id: 'doc_1', size: pdf.length, pages: [A4] }),
      ]);
      expect(template.definition.documents[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await readTemplateDocument(files, template, 'doc_1')).toEqual(pdf);
      expect(await readTemplateDocument(files, template, 'doc_other')).toBeNull();
      expect(await getTemplate(sql, otherWorkspaceId, template.id)).toBeNull();
    });

    it('refuses a staged file from another workspace or one used already', async () => {
      const foreign = await stageDocument(files, otherWorkspaceId, pdf);
      await rejectsWith(
        createTemplate(sql, files, {
          workspaceId,
          createdBy: userId,
          definition: definition(),
          documents: [{ id: 'doc_1', name: 'offer.pdf', stagedKey: foreign, pages: [A4] }],
          inspect,
        }),
        'VALIDATION',
        'documents',
      );
      const stagedKey = await stageDocument(files, workspaceId, pdf);
      const input = {
        workspaceId,
        createdBy: userId,
        definition: definition(),
        documents: [{ id: 'doc_1', name: 'offer.pdf', stagedKey, pages: [A4] }],
        inspect,
      };
      await createTemplate(sql, files, input);
      await rejectsWith(createTemplate(sql, files, input), 'VALIDATION', 'documents');
    });

    it('checks roles, fields and pages before storing anything', async () => {
      await rejectsWith(newTemplate({ name: ' ' }), 'VALIDATION', 'name');
      await rejectsWith(
        newTemplate({
          roles: [
            { id: 'role_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
            { id: 'role_hr', name: 'employee', type: 'signer', auth: 'email_link' },
          ],
        }),
        'VALIDATION',
        'roles.role_hr.name',
      );
      await rejectsWith(newTemplate({ fields: [] }), 'VALIDATION', 'fields.role_emp');
      const outside = definition().fields.map((f) => ({ ...f, page: 3 }));
      await rejectsWith(newTemplate({ fields: outside }), 'VALIDATION', 'fields');
      const wide = definition().fields.map((f) => ({ ...f, rect: { ...f.rect, x: 500 } }));
      await rejectsWith(newTemplate({ fields: wide }), 'VALIDATION', 'fields');
    });

    it('updates, duplicates, archives and restores', async () => {
      const template = await newTemplate();
      const updated = await updateTemplate(sql, workspaceId, template.id, {
        ...definition(),
        name: 'Offer letter v2',
        routing: 'parallel',
      });
      expect(updated.name).toBe('Offer letter v2');
      expect(updated.definition.routing).toBe('parallel');
      expect(updated.definition.documents).toEqual(template.definition.documents);
      await rejectsWith(
        updateTemplate(sql, otherWorkspaceId, template.id, definition()),
        'NOT_FOUND',
      );

      const copy = await duplicateTemplate(sql, files, {
        workspaceId,
        id: template.id,
        createdBy: userId,
      });
      expect(copy.id).not.toBe(template.id);
      expect(copy.name).toBe('Offer letter v2 (copy)');
      expect(await readTemplateDocument(files, copy, 'doc_1')).toEqual(pdf);

      await setTemplateArchived(sql, workspaceId, template.id, true);
      await rejectsWith(setTemplateArchived(sql, workspaceId, template.id, true), 'CONFLICT');
      await rejectsWith(updateTemplate(sql, workspaceId, template.id, definition()), 'CONFLICT');
      expect(
        (await listTemplates(sql, workspaceId, { archived: true })).map((t) => t.id),
      ).toContain(template.id);
      expect((await listTemplates(sql, workspaceId)).map((t) => t.id)).not.toContain(template.id);
      expect((await listTemplates(sql, workspaceId, { q: 'v2 (co' })).map((t) => t.id)).toEqual([
        copy.id,
      ]);
      expect(await listTemplates(sql, otherWorkspaceId)).toEqual([]);
      const counts = await countTemplates(sql, workspaceId);
      expect(counts.archived).toBeGreaterThanOrEqual(1);
      await setTemplateArchived(sql, workspaceId, template.id, false);
      expect((await getTemplate(sql, workspaceId, template.id))!.archivedAt).toBeNull();
    });
  });

  describe('bulk sends', () => {
    const person = (n: number) => ({ name: `P${n}`, email: `p${n}@example.com`, phone: '' });
    const rows = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        line: i + 2,
        people: { role_emp: person(i), role_hr: person(100) },
        metadata: { ref: `R${i}` },
      }));

    it('stores the rows and works through them, waiting out rate limits', async () => {
      const template = await newTemplate();
      const id = await createBulkSend(sql, {
        workspaceId,
        templateId: template.id,
        templateName: template.name,
        createdBy: userId,
        rows: rows(4),
      });
      expect(await getBulkSend(sql, otherWorkspaceId, id)).toBeNull();
      const before = await listBulkRows(sql, id);
      expect(before.map((r) => [r.line, r.status])).toEqual([
        [2, 'pending'],
        [3, 'pending'],
        [4, 'pending'],
        [5, 'pending'],
      ]);
      expect(before[0]!.people.role_emp!.email).toBe('p0@example.com');
      expect(before[0]!.metadata).toEqual({ ref: 'R0' });

      class Limited extends Error {}
      let limited = true;
      const sleeps: number[] = [];
      await runBulkSend(
        {
          sql,
          now: () => new Date(),
          sleep: async (ms) => void sleeps.push(ms),
          send: async (row) => {
            if (row.line === 3 && limited) {
              limited = false;
              throw new Limited();
            }
            if (row.line === 4) throw new AppError('VALIDATION', 'Bad email');
            return { envelopeId: `env_${row.line}` };
          },
          isRateLimit: (err) => (err instanceof Limited ? 7 : null),
          describe: (err) => (err as Error).message,
        },
        id,
      );
      expect(sleeps).toEqual([7000]);
      const after = await listBulkRows(sql, id);
      expect(after.map((r) => [r.line, r.status, r.envelopeId, r.error])).toEqual([
        [2, 'sent', 'env_2', null],
        [3, 'sent', 'env_3', null],
        [4, 'failed', null, 'Bad email'],
        [5, 'sent', 'env_5', null],
      ]);
      const done = await getBulkSend(sql, workspaceId, id);
      expect(done).toMatchObject({ status: 'done', total: 4, sent: 3, failed: 1 });
      expect(done!.finishedAt).toBeInstanceOf(Date);
      expect((await listBulkSends(sql, workspaceId, { templateId: template.id }))[0]!.id).toBe(id);
    });

    it('leases a send to one worker and lets it be stopped', async () => {
      const template = await newTemplate();
      const id = await createBulkSend(sql, {
        workspaceId,
        templateId: template.id,
        templateName: template.name,
        createdBy: userId,
        rows: rows(3),
      });
      const now = new Date();
      expect((await openBulkSends(sql, now)).map((b) => b.id)).toContain(id);
      expect(await claimBulkSend(sql, id, now)).toBe(true);
      expect(await claimBulkSend(sql, id, now)).toBe(false);
      expect((await openBulkSends(sql, now)).map((b) => b.id)).not.toContain(id);
      expect(await claimBulkSend(sql, id, new Date(now.getTime() + 3 * 60_000))).toBe(true);

      await rejectsWith(cancelBulkSend(sql, otherWorkspaceId, id), 'CONFLICT');
      await cancelBulkSend(sql, workspaceId, id);
      await rejectsWith(cancelBulkSend(sql, workspaceId, id), 'CONFLICT');
      const stopped = await listBulkRows(sql, id);
      expect(
        stopped.every((r) => r.status === 'failed' && r.error === 'Stopped before it was sent'),
      ).toBe(true);
      expect(await getBulkSend(sql, workspaceId, id)).toMatchObject({
        status: 'cancelled',
        failed: 3,
      });
      await rejectsWith(
        createBulkSend(sql, {
          workspaceId,
          templateId: template.id,
          templateName: 'x',
          createdBy: userId,
          rows: [],
        }),
        'VALIDATION',
      );
    });
  });

  describe('webhooks', () => {
    const input = {
      url: 'https://hooks.example.com/sign',
      description: 'CRM',
      events: ['envelope.completed'],
    };

    function report(overrides: Partial<WebhookDeliveryReport> = {}): WebhookDeliveryReport {
      return {
        deliveryId: 'd_1',
        workspaceId,
        url: input.url,
        event: 'envelope.completed',
        body: '{"id":"d_1","type":"envelope.completed"}',
        attempt: 1,
        outcome: 'failed',
        status: 500,
        error: 'Webhook hooks.example.com answered 500',
        retryAt: new Date(Date.now() + 30_000),
        at: new Date(),
        durationMs: 120,
        ...overrides,
      };
    }

    it('adds an endpoint with a secret, lists it and gives it to the sign server', async () => {
      const created = await createWebhook(sql, { ...input, workspaceId, createdBy: userId });
      expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
      const [listed] = await listWebhooks(sql, workspaceId);
      expect(listed).toMatchObject({
        id: created.id,
        url: input.url,
        enabled: true,
        events: ['envelope.completed'],
        lastDelivery: null,
      });
      expect(JSON.stringify(listed)).not.toContain(created.secret);
      expect(await webhookTargetsFor(sql, workspaceId)).toEqual([
        { url: input.url, secret: created.secret, events: ['envelope.completed'] },
      ]);
      expect(await webhookTargetsFor(sql, otherWorkspaceId)).toEqual([]);

      await rejectsWith(
        createWebhook(sql, { ...input, workspaceId, createdBy: userId }),
        'CONFLICT',
        'url',
      );
      await rejectsWith(
        createWebhook(sql, {
          ...input,
          url: 'http://hooks.example.com/x',
          workspaceId,
          createdBy: userId,
        }),
        'VALIDATION',
        'url',
      );
      await rejectsWith(
        createWebhook(
          sql,
          { ...input, url: 'https://10.0.0.1/x', workspaceId, createdBy: userId },
          {
            checkUrl: () => {
              throw new Error('Webhook URL must use a host name');
            },
          },
        ),
        'VALIDATION',
        'url',
      );

      await updateWebhook(sql, workspaceId, created.id, {
        ...input,
        events: WEBHOOK_ALL,
        description: '',
      });
      expect((await getWebhook(sql, workspaceId, created.id))!.events).toEqual(['*']);
      await rejectsWith(updateWebhook(sql, otherWorkspaceId, created.id, input), 'NOT_FOUND');

      await setWebhookEnabled(sql, workspaceId, created.id, false);
      expect(await webhookTargetsFor(sql, workspaceId)).toEqual([]);
      await setWebhookEnabled(sql, workspaceId, created.id, true);
      const rolled = await rollWebhookSecret(sql, workspaceId, created.id);
      expect(rolled).not.toBe(created.secret);
      expect((await webhookTargetsFor(sql, workspaceId))[0]!.secret).toBe(rolled);
      await deleteWebhook(sql, workspaceId, created.id);
      await rejectsWith(deleteWebhook(sql, workspaceId, created.id), 'NOT_FOUND');
    });

    it('keeps one log row per delivery and counts the attempts', async () => {
      const hook = await createWebhook(sql, { ...input, workspaceId, createdBy: userId });
      await recordDelivery(sql, report());
      await recordDelivery(
        sql,
        report({ attempt: 2, outcome: 'delivered', status: 204, error: null, retryAt: null }),
      );
      await recordDelivery(sql, report({ deliveryId: 'd_2', retryAt: null }));
      await recordDelivery(
        sql,
        report({ deliveryId: 'd_3', outcome: 'skipped', status: null, retryAt: null }),
      );
      await recordDelivery(sql, report({ deliveryId: 'd_4', url: 'https://unknown.example.com/' }));
      await recordDelivery(sql, report({ deliveryId: 'd_5', workspaceId: otherWorkspaceId }));

      const all = await listDeliveries(sql, workspaceId, hook.id);
      expect(all.map((d) => [d.deliveryId, d.status, d.attempts]).sort()).toEqual([
        ['d_1', 'delivered', 2],
        ['d_2', 'failed', 1],
        ['d_3', 'skipped', 1],
      ]);
      const first = await getDelivery(sql, workspaceId, hook.id, 'd_1');
      expect(first).toMatchObject({
        responseStatus: 204,
        error: null,
        nextRetryAt: null,
        durationMs: 120,
      });
      expect(first!.body).toContain('envelope.completed');
      expect(await getDelivery(sql, otherWorkspaceId, hook.id, 'd_1')).toBeNull();
      expect(
        (await listDeliveries(sql, workspaceId, hook.id, { status: 'problems' })).map(
          (d) => d.deliveryId,
        ),
      ).toEqual(['d_2']);
      expect((await getWebhook(sql, workspaceId, hook.id))!.lastDelivery?.status).toBeDefined();

      await recordDelivery(
        sql,
        report({ deliveryId: 'd_old', at: new Date(Date.now() - 40 * 86_400_000) }),
      );
      await pruneDeliveries(sql);
      expect(await getDelivery(sql, workspaceId, hook.id, 'd_old')).toBeNull();
      expect(await getDelivery(sql, workspaceId, hook.id, 'd_2')).not.toBeNull();

      await deleteWebhook(sql, workspaceId, hook.id);
      expect(await listDeliveries(sql, workspaceId, hook.id)).toEqual([]);
    });
  });
});

const WEBHOOK_ALL = ['*'];
