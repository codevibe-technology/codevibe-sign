import { randomUUID } from 'node:crypto';
import { memoryFileStore, type Principal } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanSettings } from '@/lib/plans';
import { getBrand, updateSigningSettings } from '@/server/brand';
import { AppError } from '@/server/errors';
import { acceptInvitation, createInvitation } from '@/server/invitations';
import { migrateAll } from '@/server/migrate';
import { setWorkspacePlan } from '@/server/plan-admin';
import {
  PlanLimitError,
  releaseUsage,
  reserveUsage,
  usageOf,
  usageReport,
  workspacePlan,
} from '@/server/plans';
import { dismissStartHere, isSampleEnvelope, startHere } from '@/server/sample-envelope';
import { createPlanGate } from '@/server/sign/plan-gate';
import {
  createTemplate,
  duplicateTemplate,
  setTemplateArchived,
  stageDocument,
  type DefinitionInput,
} from '@/server/templates';
import { createWebhook } from '@/server/webhooks';
import { createWorkspace } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const APP_URL = 'http://localhost:3000';
const A4 = { width: 595, height: 842 };
const hosted: PlanSettings = { mode: 'hosted', freeOverrides: {} };
const selfHosted: PlanSettings = { mode: 'self-hosted', freeOverrides: {} };

async function planError(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PlanLimitError);
  expect((err as AppError).code).toBe('PLAN_LIMIT');
  return err as PlanLimitError;
}

const definition = (name: string): DefinitionInput => ({
  name,
  description: '',
  title: '',
  message: '',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 0,
  roles: [{ id: 'role_a', name: 'Employee', type: 'signer', auth: 'email_link' }],
  fields: [
    {
      id: 'f1',
      documentId: 'doc_1',
      recipientId: 'role_a',
      type: 'signature',
      page: 0,
      rect: { x: 72, y: 600, width: 180, height: 48 },
      required: true,
    },
  ],
});

describe.skipIf(!url)('plans against PostgreSQL', () => {
  const schema = `web_plan_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  const files = memoryFileStore();

  async function user(name = 'Asha') {
    const id = randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id, email, name };
  }

  async function freeWorkspace(name = 'Acme') {
    const owner = await user();
    const ws = await createWorkspace(sql, { name, userId: owner.id }, hosted);
    expect(ws.plan).toBe('free');
    return { ...ws, owner };
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 8, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0006_plans');
  });

  beforeEach(() => {
    vi.stubEnv('PLAN_MODE', 'hosted');
    vi.stubEnv('FREE_PLAN_LIMITS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  describe('workspaces', () => {
    it('starts new workspaces on Free in hosted mode and Unlimited when self-hosted', async () => {
      const owner = await user();
      expect((await createWorkspace(sql, { name: 'A', userId: owner.id }, hosted)).plan).toBe(
        'free',
      );
      const other = await user();
      const ws = await createWorkspace(sql, { name: 'B', userId: other.id }, selfHosted);
      expect(ws.plan).toBe('unlimited');
      expect(await workspacePlan(sql, ws.id, selfHosted)).toMatchObject({ plan: 'unlimited' });
    });

    it('lets each person own one Free workspace', async () => {
      const { owner } = await freeWorkspace('First');
      const err = await planError(
        createWorkspace(sql, { name: 'Second', userId: owner.id }, hosted),
      );
      expect(err.limit).toBe('ownedWorkspaces');
      expect(err.message).toBe(
        'You already own 1 Free workspace, and each person can own 1. Use the one you have, ask to be invited to another, or upgrade to Cloud: write to hello@codevibe.in.',
      );
      const cloud = await createWorkspace(
        sql,
        { name: 'Paid', userId: owner.id, plan: 'cloud' },
        hosted,
      );
      expect(cloud.plan).toBe('cloud');
    });

    it('creates only one Free workspace when two arrive at once', async () => {
      const owner = await user();
      const results = await Promise.allSettled(
        ['One', 'Two', 'Three'].map((name) =>
          createWorkspace(sql, { name, userId: owner.id }, hosted),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((r) => r.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PlanLimitError);
      }
    });

    it('has no workspace limit when self-hosted', async () => {
      const owner = await user();
      for (const name of ['One', 'Two', 'Three']) {
        await createWorkspace(sql, { name, userId: owner.id }, selfHosted);
      }
    });
  });

  describe('usage counters', () => {
    it('never passes the limit when many reservations race', async () => {
      const ws = await freeWorkspace();
      const plan = { id: ws.id, ...(await workspacePlan(sql, ws.id, hosted)) };
      const results = await Promise.allSettled(
        Array.from({ length: 25 }, () => reserveUsage(sql, plan, 'envelopes_sent', 1)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
      expect(await usageOf(sql, ws.id, 'envelopes_sent')).toBe(10);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(PlanLimitError);
      expect(refused.reason.message).toMatch(
        /^This workspace has sent 10 of the 10 envelopes the Free plan allows each month\. Upgrade to Cloud: write to hello@codevibe\.in\. The count starts again on 1 /,
      );
      expect(refused.reason.resetsAt).toBeInstanceOf(Date);
    });

    it('gives a reservation back', async () => {
      const ws = await freeWorkspace();
      const plan = { id: ws.id, ...(await workspacePlan(sql, ws.id, hosted)) };
      const held = await reserveUsage(sql, plan, 'storage_bytes', 1000);
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(1000);
      await releaseUsage(sql, held);
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(0);
    });

    it('counts each month on its own', async () => {
      const ws = await freeWorkspace();
      const plan = { id: ws.id, ...(await workspacePlan(sql, ws.id, hosted)) };
      const november = new Date('2026-11-30T12:00:00Z');
      for (let i = 0; i < 10; i++) await reserveUsage(sql, plan, 'envelopes_sent', 1, november);
      await planError(reserveUsage(sql, plan, 'envelopes_sent', 1, november));
      await reserveUsage(sql, plan, 'envelopes_sent', 1, new Date('2026-12-01T00:00:00Z'));
    });

    it('refuses an amount larger than the whole limit', async () => {
      const ws = await freeWorkspace();
      const plan = { id: ws.id, ...(await workspacePlan(sql, ws.id, hosted)) };
      const err = await planError(reserveUsage(sql, plan, 'storage_bytes', 201 * 1024 * 1024));
      expect(err.limit).toBe('storageBytes');
      expect(err.message).toContain('the Free plan holds 200 MB, so these files do not fit');
    });
  });

  describe('the sign API gate', () => {
    const pdf = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

    function setup(workspaceId: string, settings: PlanSettings = hosted, key = false) {
      const forward = vi.fn<(request: Request) => Promise<Response>>(
        async () => new Response('{}', { status: 201 }),
      );
      const principal: Principal = key
        ? { id: 'key_1', workspaceId }
        : { id: 'user:u1', workspaceId };
      const samples = new Set<string>();
      const gate = createPlanGate({
        sql,
        settings: () => settings,
        authenticate: async () => principal,
        isSampleEnvelope: async (_ws, id) => samples.has(id),
        basePath: '/api',
        maxBodyBytes: 50 * 1024 * 1024,
      });
      const create = (body: unknown, headers: Record<string, string> = {}) =>
        gate(
          new Request(`${APP_URL}/api/v1/envelopes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
          }),
          forward,
        );
      const send = (id: string) =>
        gate(new Request(`${APP_URL}/api/v1/envelopes/${id}/send`, { method: 'POST' }), forward);
      const get = (headers: Record<string, string> = {}) =>
        gate(new Request(`${APP_URL}/api/v1/envelopes`, { headers }), forward);
      return { gate, forward, create, send, get, samples };
    }

    const doc = (bytes: number) => ({ name: 'a.pdf', content: pdf(bytes) });

    it('counts sent envelopes and answers 403 PLAN_LIMIT once the month is used up', async () => {
      const ws = await freeWorkspace();
      const { create, send, forward } = setup(ws.id);
      for (let i = 0; i < 6; i++) {
        expect((await create({ send: true, documents: [doc(100)] })).status).toBe(201);
      }
      for (let i = 0; i < 4; i++) expect((await send(`env_${i}`)).status).toBe(201);
      const refused = await create({ send: true, documents: [doc(100)] });
      expect(refused.status).toBe(403);
      const body = (await refused.json()) as {
        error: { code: string; message: string; details: Record<string, unknown> };
      };
      expect(body.error.code).toBe('PLAN_LIMIT');
      expect(body.error.message).toContain('has sent 10 of the 10 envelopes');
      expect(body.error.details).toMatchObject({
        limit: 'envelopesPerMonth',
        used: 10,
        max: 10,
        plan: 'free',
      });
      expect((await send('env_x')).status).toBe(403);
      expect(forward).toHaveBeenCalledTimes(10);
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(600);
    });

    it('does not count drafts against the monthly sends', async () => {
      const ws = await freeWorkspace();
      const { create } = setup(ws.id);
      for (let i = 0; i < 12; i++) {
        expect((await create({ documents: [doc(10)] })).status).toBe(201);
      }
      expect(await usageOf(sql, ws.id, 'envelopes_sent')).toBe(0);
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(120);
    });

    it('gives the send and the storage back when the server refuses the envelope', async () => {
      const ws = await freeWorkspace();
      const { create, forward } = setup(ws.id);
      forward.mockResolvedValueOnce(new Response('{}', { status: 400 }));
      expect((await create({ send: true, documents: [doc(500)] })).status).toBe(400);
      forward.mockRejectedValueOnce(new Error('down'));
      await expect(create({ send: true, documents: [doc(500)] })).rejects.toThrow('down');
      expect(await usageOf(sql, ws.id, 'envelopes_sent')).toBe(0);
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(0);
    });

    it('refuses a PDF over 10 MB and an envelope over 25 MB before the server sees it', async () => {
      const ws = await freeWorkspace();
      const { create, forward } = setup(ws.id);
      const big = await create({ documents: [doc(10 * 1024 * 1024 + 1)] });
      expect(big.status).toBe(403);
      const bigBody = (await big.json()) as { error: { message: string; details: object } };
      expect(bigBody.error.message).toBe(
        'This PDF is just over 10 MB, and the Free plan takes files up to 10 MB. Compress or split it, or upgrade to Cloud: write to hello@codevibe.in.',
      );
      expect(bigBody.error.details).toMatchObject({ limit: 'fileBytes' });
      const many = await create({
        documents: [doc(9 * 1024 * 1024), doc(9 * 1024 * 1024), doc(9 * 1024 * 1024)],
      });
      expect(many.status).toBe(403);
      expect(((await many.json()) as { error: { message: string } }).error.message).toContain(
        'These PDFs add up to 27 MB, and the Free plan takes up to 25 MB in one envelope.',
      );
      expect(forward).not.toHaveBeenCalled();
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(0);
    });

    it('reads file sizes from multipart uploads too', async () => {
      const ws = await freeWorkspace();
      const { gate, forward } = setup(ws.id);
      const form = new FormData();
      form.set('envelope', JSON.stringify({ send: true }));
      form.append('documents', new Blob([new Uint8Array(11 * 1024 * 1024)]), 'a.pdf');
      const res = await gate(
        new Request(`${APP_URL}/api/v1/envelopes`, { method: 'POST', body: form }),
        forward,
      );
      expect(res.status).toBe(403);
      expect(forward).not.toHaveBeenCalled();
    });

    it('stops at the stored-documents limit', async () => {
      const ws = await freeWorkspace();
      const { create } = setup(ws.id, {
        mode: 'hosted',
        freeOverrides: { storageBytes: 1000 },
      });
      expect((await create({ documents: [doc(600)] })).status).toBe(201);
      const refused = await create({ documents: [doc(600)] });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
        'This workspace stores 600 bytes of documents, and the Free plan holds 1000 bytes, so these files do not fit. Upgrade to Cloud: write to hello@codevibe.in.',
      );
    });

    it('counts API-key requests per day, but not the app’s own calls', async () => {
      const ws = await freeWorkspace();
      const settings: PlanSettings = { mode: 'hosted', freeOverrides: { apiRequestsPerDay: 2 } };
      const byKey = setup(ws.id, settings, true);
      const auth = { authorization: 'Bearer cvs_x' };
      expect((await byKey.get(auth)).status).toBe(201);
      expect((await byKey.get(auth)).status).toBe(201);
      const refused = await byKey.get(auth);
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
        'This workspace has made 2 of the 2 API requests the Free plan allows each day. Try again after 00:00 UTC, or upgrade to Cloud: write to hello@codevibe.in.',
      );
      const bySession = setup(ws.id, settings);
      expect((await bySession.get()).status).toBe(201);
      expect(await usageOf(sql, ws.id, 'api_requests')).toBe(2);
    });

    it('lets the first-run sample be sent without counting it', async () => {
      const ws = await freeWorkspace();
      const { send, samples } = setup(ws.id);
      samples.add('env_sample');
      expect((await send('env_sample')).status).toBe(201);
      expect(await usageOf(sql, ws.id, 'envelopes_sent')).toBe(0);
    });

    it('passes everything through untouched when self-hosted', async () => {
      const ws = await freeWorkspace();
      const { create, forward } = setup(ws.id, selfHosted, true);
      for (let i = 0; i < 12; i++) {
        const res = await create(
          { send: true, documents: [doc(11 * 1024 * 1024)] },
          { authorization: 'Bearer cvs_x' },
        );
        expect(res.status).toBe(201);
      }
      expect(forward).toHaveBeenCalledTimes(12);
      expect(await usageOf(sql, ws.id, 'envelopes_sent')).toBe(0);
      expect(await usageOf(sql, ws.id, 'api_requests')).toBe(0);
    });

    it('leaves signer routes alone', async () => {
      const ws = await freeWorkspace();
      const { gate, forward } = setup(ws.id, hosted, true);
      for (let i = 0; i < 3; i++) {
        await gate(
          new Request(`${APP_URL}/api/v1/sign/link/submit`, {
            method: 'POST',
            headers: { authorization: 'Bearer cvs_x' },
            body: '{}',
          }),
          forward,
        );
      }
      expect(forward).toHaveBeenCalledTimes(3);
      expect(await usageOf(sql, ws.id, 'api_requests')).toBe(0);
    });
  });

  describe('members', () => {
    const invite = (workspaceId: string, owner: { id: string }, email: string) =>
      createInvitation(sql, {
        workspaceId,
        email,
        role: 'member',
        invitedBy: { userId: owner.id, role: 'owner' },
      });

    it('counts members and open invitations against 3 seats', async () => {
      const ws = await freeWorkspace();
      await invite(ws.id, ws.owner, 'one@example.com');
      await invite(ws.id, ws.owner, 'two@example.com');
      await invite(ws.id, ws.owner, 'two@example.com');
      const err = await planError(invite(ws.id, ws.owner, 'three@example.com'));
      expect(err.field).toBe('email');
      expect(err.message).toBe(
        'This workspace has 3 members and open invitations, and the Free plan allows 3. Remove someone or cancel an invitation, or upgrade to Cloud: write to hello@codevibe.in.',
      );
    });

    it('refuses to accept an invitation once the seats are taken', async () => {
      const owner = await user();
      const ws = await createWorkspace(
        sql,
        { name: 'Big', userId: owner.id, plan: 'cloud' },
        hosted,
      );
      const people = await Promise.all([user('Mia'), user('Ravi'), user('Zoe')]);
      const tokens = [];
      for (const person of people) tokens.push((await invite(ws.id, owner, person.email)).token);
      await setWorkspacePlan(sql, { slug: ws.slug, plan: 'free', changedBy: 'test' });
      await acceptInvitation(sql, tokens[0]!, people[0]!);
      await acceptInvitation(sql, tokens[1]!, people[1]!);
      const err = await planError(acceptInvitation(sql, tokens[2]!, people[2]!));
      expect(err.limit).toBe('members');
      const [row] = await sql`select accepted_at from app_invitations where workspace_id = ${ws.id}
        and lower(email) = ${people[2]!.email}`;
      expect(row?.accepted_at).toBeNull();
    });

    it('takes the last seat only once when invitations race', async () => {
      const ws = await freeWorkspace();
      await invite(ws.id, ws.owner, 'one@example.com');
      const results = await Promise.allSettled(
        ['a', 'b', 'c', 'd'].map((n) => invite(ws.id, ws.owner, `${n}@example.com`)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('has no seat limit when self-hosted', async () => {
      vi.stubEnv('PLAN_MODE', 'self-hosted');
      const ws = await freeWorkspace();
      for (const n of ['a', 'b', 'c', 'd', 'e']) await invite(ws.id, ws.owner, `${n}@example.com`);
    });
  });

  describe('templates', () => {
    const pdf = new Uint8Array(2048);
    const inspect = async () => ({ pages: [A4] });

    async function template(workspaceId: string, userId: string, name: string) {
      const stagedKey = await stageDocument(files, workspaceId, pdf);
      return createTemplate(sql, files, {
        workspaceId,
        createdBy: userId,
        definition: definition(name),
        documents: [{ id: 'doc_1', name: 'a.pdf', stagedKey, pages: [A4] }],
        inspect,
      });
    }

    it('keeps 5 active templates and points at archiving', async () => {
      const ws = await freeWorkspace();
      const made = [];
      for (let i = 1; i <= 5; i++) made.push(await template(ws.id, ws.owner.id, `T${i}`));
      const err = await planError(template(ws.id, ws.owner.id, 'T6'));
      expect(err.message).toBe(
        'This workspace has 5 active templates, and the Free plan allows 5. Archive a template you no longer use, or upgrade to Cloud: write to hello@codevibe.in.',
      );
      await planError(
        duplicateTemplate(sql, files, {
          workspaceId: ws.id,
          id: made[0]!.id,
          createdBy: ws.owner.id,
        }),
      );
      await setTemplateArchived(sql, ws.id, made[0]!.id, true);
      const sixth = await template(ws.id, ws.owner.id, 'T6');
      await planError(setTemplateArchived(sql, ws.id, made[0]!.id, false));
      await setTemplateArchived(sql, ws.id, sixth.id, true);
      await setTemplateArchived(sql, ws.id, made[0]!.id, false);
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(6 * 2048);
    });

    it('removes the copied files when a template is refused', async () => {
      const ws = await freeWorkspace();
      for (let i = 1; i <= 4; i++) await template(ws.id, ws.owner.id, `T${i}`);
      const results = await Promise.allSettled(
        [5, 6, 7].map((i) => template(ws.id, ws.owner.id, `T${i}`)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from app_templates
        where workspace_id = ${ws.id}`;
      expect(count?.n).toBe(5);
    });

    it('has no template limit when self-hosted', async () => {
      vi.stubEnv('PLAN_MODE', 'self-hosted');
      const ws = await freeWorkspace();
      for (let i = 1; i <= 7; i++) await template(ws.id, ws.owner.id, `T${i}`);
      expect(await usageOf(sql, ws.id, 'storage_bytes')).toBe(0);
    });
  });

  describe('webhooks', () => {
    const input = (n: number) => ({
      url: `https://hooks.example.com/${n}`,
      description: '',
      events: ['envelope.completed'],
    });

    it('allows 1 endpoint on Free', async () => {
      const ws = await freeWorkspace();
      await createWebhook(sql, { ...input(1), workspaceId: ws.id, createdBy: ws.owner.id });
      const err = await planError(
        createWebhook(sql, { ...input(2), workspaceId: ws.id, createdBy: ws.owner.id }),
      );
      expect(err.message).toBe(
        'This workspace has 1 webhook endpoint, and the Free plan allows 1. Remove one first, or upgrade to Cloud: write to hello@codevibe.in.',
      );
    });

    it('allows more on Cloud', async () => {
      const ws = await freeWorkspace();
      await setWorkspacePlan(sql, { slug: ws.slug, plan: 'cloud', changedBy: 'test' });
      for (let i = 1; i <= 3; i++) {
        await createWebhook(sql, { ...input(i), workspaceId: ws.id, createdBy: ws.owner.id });
      }
    });
  });

  describe('brand', () => {
    const settings = { showBadge: true, certificateFooter: null, signingDomain: null };

    it('keeps the badge and refuses a custom domain on Free', async () => {
      const ws = await freeWorkspace();
      const badge = await planError(
        updateSigningSettings(sql, ws.id, { ...settings, showBadge: false }, 'localhost'),
      );
      expect(badge.field).toBe('showBadge');
      const domain = await planError(
        updateSigningSettings(
          sql,
          ws.id,
          { ...settings, signingDomain: 'sign.acme.in' },
          'localhost',
        ),
      );
      expect(domain.field).toBe('signingDomain');
      expect(domain.message).toContain('Custom signing domains are not part of the Free plan.');
      await updateSigningSettings(
        sql,
        ws.id,
        { ...settings, certificateFooter: 'Acme' },
        'localhost',
      );
    });

    it('shows the badge on Free even when it was turned off on another plan', async () => {
      const ws = await freeWorkspace();
      await setWorkspacePlan(sql, { slug: ws.slug, plan: 'cloud', changedBy: 'test' });
      await updateSigningSettings(
        sql,
        ws.id,
        { ...settings, showBadge: false, signingDomain: 'sign.acme-cloud.in' },
        'localhost',
      );
      expect((await getBrand(sql, ws.id)).showBadge).toBe(false);
      await setWorkspacePlan(sql, { slug: ws.slug, plan: 'free', changedBy: 'test' });
      expect((await getBrand(sql, ws.id)).showBadge).toBe(true);
    });
  });

  describe('plan:set', () => {
    it('changes the plan and records who did it', async () => {
      const ws = await freeWorkspace();
      const change = await setWorkspacePlan(sql, {
        slug: ws.slug,
        plan: 'cloud',
        changedBy: 'script:ops',
      });
      expect(change).toEqual({ workspaceId: ws.id, slug: ws.slug, from: 'free', to: 'cloud' });
      expect((await workspacePlan(sql, ws.id, hosted)).plan).toBe('cloud');
      const audit = await sql`select from_plan, to_plan, changed_by from app_plan_changes
        where workspace_id = ${ws.id}`;
      expect(audit).toEqual([{ from_plan: 'free', to_plan: 'cloud', changed_by: 'script:ops' }]);
    });

    it('refuses an unknown plan or workspace', async () => {
      const ws = await freeWorkspace();
      await expect(
        setWorkspacePlan(sql, { slug: ws.slug, plan: 'gold', changedBy: 'x' }),
      ).rejects.toThrow('Unknown plan "gold". Use free, cloud or unlimited.');
      await expect(
        setWorkspacePlan(sql, { slug: 'nope-nope', plan: 'cloud', changedBy: 'x' }),
      ).rejects.toThrow('No workspace has the slug "nope-nope".');
    });
  });

  describe('usage report', () => {
    it('lists every meter with its limit and the monthly reset', async () => {
      const ws = await freeWorkspace();
      const plan = { id: ws.id, ...(await workspacePlan(sql, ws.id, hosted)) };
      const now = new Date('2026-11-20T10:00:00Z');
      await reserveUsage(sql, plan, 'envelopes_sent', 3, now);
      await reserveUsage(sql, plan, 'storage_bytes', 5 * 1024 * 1024, now);
      const report = await usageReport(sql, ws.id, hosted, now);
      expect(report.plan).toBe('free');
      const byKey = Object.fromEntries(report.lines.map((l) => [l.key, l]));
      expect(byKey.envelopesPerMonth).toMatchObject({
        used: 3,
        max: 10,
        resetsAt: '1 December 2026',
      });
      expect(byKey.members).toMatchObject({ used: 1, max: 3, resetsAt: null });
      expect(byKey.storageBytes).toMatchObject({ usedText: '5 MB', maxText: '200 MB' });
      expect(byKey.apiRequestsPerDay).toMatchObject({ used: 0, resetsAt: '21 November 2026' });
    });

    it('shows no limits when self-hosted', async () => {
      const ws = await freeWorkspace();
      const report = await usageReport(sql, ws.id, selfHosted);
      expect(report.plan).toBe('unlimited');
      expect(report.lines.every((l) => l.max === null)).toBe(true);
    });
  });

  describe('first run', () => {
    it('remembers the sample and hides the card once dismissed', async () => {
      const ws = await freeWorkspace();
      expect(await startHere(sql, ws.id)).toBeNull();
      await sql`insert into app_first_run (workspace_id, envelope_id) values (${ws.id}, 'env_s')`;
      expect(await startHere(sql, ws.id)).toBe('env_s');
      expect(await isSampleEnvelope(sql, ws.id, 'env_s')).toBe(true);
      expect(await isSampleEnvelope(sql, ws.id, 'env_other')).toBe(false);
      const other = await freeWorkspace('Other');
      expect(await isSampleEnvelope(sql, other.id, 'env_s')).toBe(false);
      await dismissStartHere(sql, ws.id);
      expect(await startHere(sql, ws.id)).toBeNull();
      expect(await isSampleEnvelope(sql, ws.id, 'env_s')).toBe(true);
    });
  });
});
