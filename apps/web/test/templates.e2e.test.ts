import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  memoryStore,
  type SignServer,
  type WebhookDeliveryReport,
} from '@codevibe_technology/sign-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TemplateDefinition } from '@/lib/templates';
import type { TemplateRecord } from '@/server/templates';
import { makeP12, makePdf } from './fixtures';

const APP_URL = 'http://localhost:3000';
const config = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/server/env', () => ({ env: () => config.value }));
vi.mock('@/server/db', () => ({ db: () => ({}) }));

const A4 = { width: 595.28, height: 841.89 };
const definition: TemplateDefinition = {
  title: '',
  message: 'Welcome aboard',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 2,
  roles: [
    { id: 'r_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
    { id: 'r_hr', name: 'HR', type: 'approver', auth: 'email_link' },
    { id: 'r_cc', name: 'Payroll', type: 'viewer', auth: 'email_link' },
  ],
  documents: [{ id: 'doc_1', name: 'offer.pdf', size: 0, sha256: '', pages: [A4] }],
  fields: [
    {
      id: 'f1',
      documentId: 'doc_1',
      recipientId: 'r_emp',
      type: 'signature',
      page: 0,
      rect: { x: 72, y: 600, width: 180, height: 48 },
      required: true,
    },
  ],
};

describe('templates and webhooks through the sign server', () => {
  let dir: string;
  let sign: SignServer;
  const files = memoryFileStore();
  const reports: WebhookDeliveryReport[] = [];
  const posted: { url: string; body: string }[] = [];
  const template: TemplateRecord = {
    id: 'tpl_1',
    workspaceId: 'ws_acme',
    name: 'Offer letter',
    description: null,
    definition,
    createdBy: 'u_asha',
    createdByName: 'Asha',
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cvs-web-tpl-'));
    const p12 = makeP12('pass');
    writeFileSync(join(dir, 'seal.p12'), p12);
    config.value = { APP_URL, SEAL_P12_PATH: join(dir, 'seal.p12'), SEAL_PASSPHRASE: 'pass' };
    const { inProcess } = await import('@/server/sign/principal');
    sign = createSignServer({
      store: memoryStore(),
      files: memoryFileStore(),
      mailer: consoleMailer({ silent: true }),
      otp: consoleOtpSender({ silent: true }),
      sealer: { p12, passphrase: 'pass' },
      apiKeys: [],
      authenticate: async (request) => inProcess.get(request) ?? null,
      limits: { envelopesPerMinute: 2 },
      webhookTargets: async (workspaceId) =>
        workspaceId === 'ws_acme'
          ? [
              {
                url: 'https://hooks.example.com/sign',
                secret: 'whsec_0123456789abcdef',
                events: ['envelope.sent'],
              },
            ]
          : [],
      webhookSecurity: { lookup: async () => ['93.184.215.14'] },
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        posted.push({ url: String(url), body: String(init?.body) });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      onWebhookDelivery: (report) => void reports.push(report),
      basePath: '/api',
      publicUrl: APP_URL,
    });
    (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign = sign;
    const { templateFileKey } = await import('@/server/templates');
    await files.put(
      templateFileKey('ws_acme', 'tpl_1', 'doc_1'),
      await makePdf(1),
      'application/pdf',
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign;
  });

  it('creates and sends an envelope with one recipient per role', async () => {
    const { signRequest } = await import('@/server/sign/client');
    const { sendFromTemplate } = await import('@/server/template-send');
    const senders: unknown[] = [];
    const deps = {
      files,
      request: signRequest,
      recordSender: async (r: unknown) => void senders.push(r),
    };
    const envelope = await sendFromTemplate(deps, {
      template,
      userId: 'u_asha',
      people: {
        r_emp: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '' },
        r_hr: { name: 'Meera', email: 'hr@example.com', phone: '' },
        r_cc: { name: 'Payroll', email: 'payroll@example.com', phone: '' },
      },
      metadata: { bulkSendId: 'bulk_1' },
    });
    expect(envelope.status).toBe('sent');
    expect(envelope.title).toBe('Offer letter');
    expect(envelope.metadata).toMatchObject({ templateId: 'tpl_1', bulkSendId: 'bulk_1' });
    expect(envelope.recipients.map((r) => [r.name, r.role, r.order])).toEqual([
      ['Ravi Kumar', 'signer', 1],
      ['Meera', 'approver', 2],
      ['Payroll', 'viewer', expect.any(Number)],
    ]);
    expect(envelope.fields).toHaveLength(1);
    expect(envelope.fields[0]!.recipientId).toBe(envelope.recipients[0]!.id);
    expect(senders).toEqual([
      { workspaceId: 'ws_acme', envelopeId: envelope.id, userId: 'u_asha' },
    ]);

    await sign.idle();
    expect(posted.map((p) => JSON.parse(p.body).type)).toEqual(['envelope.sent']);
    expect(reports.at(-1)).toMatchObject({
      workspaceId: 'ws_acme',
      outcome: 'delivered',
      status: 204,
    });

    const test = await sign.sendTestWebhook({
      workspaceId: 'ws_acme',
      url: 'https://hooks.example.com/sign',
    });
    expect(test).toMatchObject({ outcome: 'delivered', event: 'webhook.test' });

    const second = await sendFromTemplate(deps, {
      template,
      userId: 'u_asha',
      people: {
        r_emp: { name: 'Mia', email: 'mia@example.com', phone: '' },
        r_hr: { name: 'Meera', email: 'hr@example.com', phone: '' },
        r_cc: { name: 'Payroll', email: 'payroll@example.com', phone: '' },
      },
    });
    expect(second.status).toBe('sent');
    const { RateLimitedError } = await import('@/server/template-send');
    await expect(
      sendFromTemplate(deps, {
        template,
        userId: 'u_asha',
        people: {
          r_emp: { name: 'Zoe', email: 'zoe@example.com', phone: '' },
          r_hr: { name: 'Meera', email: 'hr@example.com', phone: '' },
          r_cc: { name: 'Payroll', email: 'payroll@example.com', phone: '' },
        },
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  }, 60_000);

  it('maps a refusal back to the role it is about', async () => {
    const { signRequest } = await import('@/server/sign/client');
    const { sendFromTemplate, roleField } = await import('@/server/template-send');
    const err = await sendFromTemplate(
      { files, request: signRequest, recordSender: async () => undefined },
      {
        template: { ...template, workspaceId: 'ws_other' },
        userId: 'u_asha',
        people: {},
      },
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/missing from storage/),
    });
    expect(roleField('recipients[1].email', template)).toBe('people.r_hr.email');
    expect(roleField('recipients[0]', template)).toBe('people.r_emp.name');
    expect(roleField('recipients[9].email', template)).toBeUndefined();
    expect(roleField('title', template)).toBe('title');
  });
});
