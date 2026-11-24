import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { memoryFileStore, type Principal } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FREE_PLAN_LIMITS, type Plan, type PlanSettings } from '@/lib/plans';
import { updateSigningSettings } from '@/server/brand';
import { acceptInvitation, createInvitation } from '@/server/invitations';
import { changeRole, removeMember } from '@/server/members';
import { migrateAll } from '@/server/migrate';
import { setAccountPlanByName } from '@/server/plan-admin';
import {
  PlanLimitError,
  assertOwnEsignAccount,
  assertWithin,
  reserveUsage,
  usageOf,
  usageReport,
  workspaceEntitlements,
  workspacePlan,
} from '@/server/plans';
import { createPlanGate } from '@/server/sign/plan-gate';
import {
  createTemplate,
  duplicateTemplate,
  setTemplateArchived,
  stageDocument,
  type DefinitionInput,
} from '@/server/templates';
import {
  assertWebhooksLive,
  createWebhook,
  listWebhooks,
  setWebhookEnabled,
  webhookTargetsFor,
} from '@/server/webhooks';
import { acceptTransfer, startTransfer } from '@/server/transfers';
import { createWorkspace, newWorkspaceBlock } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const APP_URL = 'http://localhost:3000';
const A4 = { width: 595, height: 842 };
const hosted: PlanSettings = { mode: 'hosted', freeOverrides: {} };
const selfHosted: PlanSettings = { mode: 'self-hosted', freeOverrides: {} };

/** A workspace as the matrix sees it: its plan, or a self-hosted install where plans do not apply. */
type Case = Plan | 'self-hosted';
const CASES: Case[] = ['free', 'cloud', 'unlimited', 'self-hosted'];

type Via = 'action' | 'api' | 'page' | 'background';

interface EntryPoint {
  id: string;
  feature: string;
  via: Via;
  /** Whether a Free workspace at its limit is refused here. Everything else is let through. */
  attempt: (ctx: Ctx) => Promise<void>;
}

interface Ctx {
  kind: Case;
  settings: PlanSettings;
  ws: { id: string; slug: string; accountId: string };
  owner: { id: string; email: string };
}

class Refused extends Error {}

/** Turns a gate answer into the same pass or refusal the direct calls give. */
async function expectForwarded(response: Response, forward: { mock: { calls: unknown[] } }) {
  if (response.status === 403 || response.status === 429) {
    const body = (await response.json()) as { error?: { code?: string } };
    if (body.error?.code === 'PLAN_LIMIT') throw new Refused('PLAN_LIMIT');
  }
  expect(forward.mock.calls.length).toBeGreaterThan(0);
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

const signing = {
  showBadge: true,
  certificateFooter: '',
  signingDomain: '',
};

describe.skipIf(!url)('every entry point applies the plan', () => {
  const schema = `web_plan_matrix_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  const files = memoryFileStore();
  const sizes = new Map<string, { id: string; bytes: number }[]>();

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0013_accounts');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  async function user(name = 'Asha') {
    const id = randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id, email };
  }

  async function member(workspaceId: string, role = 'member') {
    const person = await user('Member');
    await sql`insert into app_members (workspace_id, user_id, role)
      values (${workspaceId}, ${person.id}, ${role})`;
    return person;
  }

  /** Stubs the environment the server functions read and makes a workspace for the case. */
  async function context(kind: Case): Promise<Ctx> {
    const settings = kind === 'self-hosted' ? selfHosted : hosted;
    vi.stubEnv('PLAN_MODE', settings.mode);
    vi.stubEnv('FREE_PLAN_LIMITS', '');
    vi.stubEnv('CLOUD_INCLUDED_MEMBERS', '');
    const owner = await user('Owner');
    const plan: Plan = kind === 'self-hosted' ? 'unlimited' : kind;
    const ws = await createWorkspace(
      sql,
      { name: `Matrix ${kind}`, userId: owner.id, plan },
      hosted,
    );
    return { kind, settings, ws, owner };
  }

  const setPlan = (slug: string, plan: Plan) =>
    setAccountPlanByName(sql, { target: slug, plan, changedBy: 'test' });

  /** Runs `work` with the workspace lifted to Unlimited, to build a state Free would refuse. */
  async function unlimited<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
    if (ctx.kind === 'self-hosted' || ctx.kind === 'unlimited') return work();
    await setPlan(ctx.ws.slug, 'unlimited');
    try {
      return await work();
    } finally {
      await setPlan(ctx.ws.slug, ctx.kind);
    }
  }

  const pdf = new Uint8Array(2048);

  async function template(ctx: Ctx, name: string) {
    const stagedKey = await stageDocument(files, ctx.ws.id, pdf);
    return createTemplate(sql, files, {
      workspaceId: ctx.ws.id,
      createdBy: ctx.owner.id,
      definition: definition(name),
      documents: [{ id: 'doc_1', name: 'a.pdf', stagedKey, pages: [A4] }],
      inspect: async () => ({ pages: [A4] }),
    });
  }

  const fillTemplates = (ctx: Ctx) =>
    unlimited(ctx, async () => {
      const made = [];
      for (let i = 0; i < FREE_PLAN_LIMITS.activeTemplates!; i++) {
        made.push(await template(ctx, `T${i}`));
      }
      return made;
    });

  const hook = (n: number) => ({
    url: `https://hooks.example.com/${n}-${randomUUID().slice(0, 6)}`,
    description: '',
    events: ['envelope.completed'],
  });

  const existingHook = (ctx: Ctx) =>
    unlimited(ctx, () =>
      createWebhook(sql, { ...hook(1), workspaceId: ctx.ws.id, createdBy: ctx.owner.id }),
    );

  function gate(ctx: Ctx, key = false, now?: () => Date) {
    const forward = vi.fn<(request: Request) => Promise<Response>>(
      async () => new Response('{}', { status: 201 }),
    );
    const principal: Principal = key
      ? { id: 'key_1', workspaceId: ctx.ws.id }
      : { id: `user:${ctx.owner.id}`, workspaceId: ctx.ws.id };
    const run = createPlanGate({
      sql,
      settings: () => ctx.settings,
      authenticate: async () => principal,
      templateSizes: async () => [2048],
      documentSizes: async (_workspace, envelopeId) => sizes.get(envelopeId) ?? null,
      basePath: '/api',
      maxBodyBytes: 50 * 1024 * 1024,
      ...(now ? { now } : {}),
    });
    const call = (method: string, path: string, body?: unknown) =>
      run(
        new Request(`${APP_URL}${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(key ? { authorization: 'Bearer cvs_x' } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        forward,
      );
    return { call, forward };
  }

  async function useUp(ctx: Ctx, metric: 'envelopes_sent' | 'api_requests_month', amount: number) {
    if (ctx.kind === 'self-hosted') return;
    await sql`insert into app_usage (workspace_id, metric, period, used)
      select ${ctx.ws.id}, ${metric}, to_char(now() at time zone ${
        metric === 'api_requests_month' ? 'Asia/Kolkata' : 'UTC'
      }, 'YYYY-MM'), ${amount}`;
  }

  const content = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

  async function sendVia(ctx: Ctx, method: string, path: string, body?: unknown) {
    await useUp(ctx, 'envelopes_sent', FREE_PLAN_LIMITS.envelopesPerMonth!);
    const { call, forward } = gate(ctx);
    await expectForwarded(await call(method, path, body), forward);
  }

  const draft = { send: true, documents: [{ name: 'a.pdf', content: content(100) }] };
  const tooBig = FREE_PLAN_LIMITS.fileBytes! + 1;

  const ENTRY_POINTS: EntryPoint[] = [
    {
      id: 'members.invite',
      feature: 'members',
      via: 'action',
      attempt: async (ctx) => {
        await member(ctx.ws.id);
        await createInvitation(sql, {
          workspaceId: ctx.ws.id,
          email: 'new@example.com',
          role: 'member',
          invitedBy: { userId: ctx.owner.id, role: 'owner' },
        });
      },
    },
    {
      id: 'members.accept',
      feature: 'members',
      via: 'page',
      attempt: async (ctx) => {
        const invited = await user('Invited');
        const { token } = await createInvitation(sql, {
          workspaceId: ctx.ws.id,
          email: invited.email,
          role: 'member',
          invitedBy: { userId: ctx.owner.id, role: 'owner' },
        });
        await member(ctx.ws.id);
        await acceptInvitation(sql, token, invited);
      },
    },
    {
      id: 'owners.create',
      feature: 'ownedWorkspaces',
      via: 'action',
      attempt: async (ctx) => {
        const plan: Plan = ctx.kind === 'self-hosted' ? 'unlimited' : ctx.kind;
        await createWorkspace(sql, { name: 'Another', userId: ctx.owner.id, plan }, ctx.settings);
      },
    },
    {
      id: 'owners.transfer',
      feature: 'ownedWorkspaces',
      via: 'action',
      attempt: async (ctx) => {
        const donor = await user('Donor');
        const offered = await createWorkspace(
          sql,
          { name: 'Offered', userId: donor.id, plan: 'cloud' },
          hosted,
        );
        await sql`insert into app_members (workspace_id, user_id, role)
          values (${offered.id}, ${ctx.owner.id}, 'member')`;
        const offer = await startTransfer(
          sql,
          {
            workspaceId: offered.id,
            actor: { userId: donor.id, role: 'owner' },
            email: ctx.owner.email,
            previousOwnerStays: true,
          },
          ctx.settings,
        );
        await acceptTransfer(
          sql,
          { transferId: offer.id, user: ctx.owner, confirmedBy: 'password' },
          ctx.settings,
        );
      },
    },
    {
      id: 'templates.create',
      feature: 'activeTemplates',
      via: 'action',
      attempt: async (ctx) => {
        await fillTemplates(ctx);
        await template(ctx, 'One more');
      },
    },
    {
      id: 'templates.duplicate',
      feature: 'activeTemplates',
      via: 'action',
      attempt: async (ctx) => {
        const made = await fillTemplates(ctx);
        await duplicateTemplate(sql, files, {
          workspaceId: ctx.ws.id,
          id: made[0]!.id,
          createdBy: ctx.owner.id,
        });
      },
    },
    {
      id: 'templates.restore',
      feature: 'activeTemplates',
      via: 'action',
      attempt: async (ctx) => {
        const archived = await unlimited(ctx, async () => {
          const one = await template(ctx, 'Archived');
          await setTemplateArchived(sql, ctx.ws.id, one.id, true);
          return one;
        });
        await fillTemplates(ctx);
        await setTemplateArchived(sql, ctx.ws.id, archived.id, false);
      },
    },
    {
      id: 'webhooks.create',
      feature: 'webhooks',
      via: 'action',
      attempt: async (ctx) => {
        await createWebhook(sql, { ...hook(2), workspaceId: ctx.ws.id, createdBy: ctx.owner.id });
      },
    },
    {
      id: 'webhooks.enable',
      feature: 'webhooks',
      via: 'action',
      attempt: async (ctx) => {
        const { id } = await existingHook(ctx);
        await setWebhookEnabled(sql, ctx.ws.id, id, false);
        await setWebhookEnabled(sql, ctx.ws.id, id, true);
      },
    },
    {
      id: 'webhooks.send',
      feature: 'webhooks',
      via: 'action',
      attempt: async (ctx) => {
        await existingHook(ctx);
        await assertWebhooksLive(sql, ctx.ws.id);
      },
    },
    {
      id: 'webhooks.deliver',
      feature: 'webhooks',
      via: 'background',
      attempt: async (ctx) => {
        await existingHook(ctx);
        if ((await webhookTargetsFor(sql, ctx.ws.id)).length === 0) throw new Refused('paused');
      },
    },
    {
      id: 'bulk.rows',
      feature: 'bulkRows',
      via: 'action',
      attempt: async (ctx) => {
        assertWithin(
          await workspacePlan(sql, ctx.ws.id),
          'bulkRows',
          FREE_PLAN_LIMITS.bulkRows! + 1,
          'csv',
        );
      },
    },
    {
      id: 'api.requests',
      feature: 'apiRequestsPerMonth',
      via: 'api',
      attempt: async (ctx) => {
        await useUp(ctx, 'api_requests_month', FREE_PLAN_LIMITS.apiRequestsPerMonth!);
        const { call, forward } = gate(ctx, true);
        await expectForwarded(await call('GET', '/api/v1/envelopes'), forward);
      },
    },
    {
      id: 'envelopes.create',
      feature: 'envelopesPerMonth',
      via: 'api',
      attempt: (ctx) => sendVia(ctx, 'POST', '/api/v1/envelopes', draft),
    },
    {
      id: 'envelopes.send',
      feature: 'envelopesPerMonth',
      via: 'api',
      attempt: (ctx) => sendVia(ctx, 'POST', '/api/v1/envelopes/env_1/send'),
    },
    {
      id: 'envelopes.from-template',
      feature: 'envelopesPerMonth',
      via: 'api',
      attempt: (ctx) => sendVia(ctx, 'POST', '/api/v1/templates/tpl_1/envelopes', { send: true }),
    },
    {
      id: 'envelopes.send.escaped',
      feature: 'envelopesPerMonth',
      via: 'api',
      attempt: (ctx) => sendVia(ctx, 'POST', '/api/v1/envelopes/env_1/%73end'),
    },
    {
      id: 'envelopes.send.escaped-prefix',
      feature: 'envelopesPerMonth',
      via: 'api',
      attempt: (ctx) => sendVia(ctx, 'POST', '/api/%76%31/%65nvelopes/env_1/send/'),
    },
    {
      id: 'envelopes.create.slashes',
      feature: 'envelopesPerMonth',
      via: 'api',
      attempt: (ctx) => sendVia(ctx, 'POST', '/api//v1///envelopes//', draft),
    },
    {
      id: 'envelopes.create.dots',
      feature: 'envelopesPerMonth',
      via: 'api',
      attempt: (ctx) => sendVia(ctx, 'POST', '/api/v1/x/%2e%2e/envelopes', draft),
    },
    {
      id: 'files.create',
      feature: 'fileBytes',
      via: 'api',
      attempt: async (ctx) => {
        const { call, forward } = gate(ctx);
        const body = { documents: [{ name: 'a.pdf', content: content(tooBig) }] };
        await expectForwarded(await call('POST', '/api/v1/envelopes', body), forward);
      },
    },
    {
      id: 'files.replace',
      feature: 'fileBytes',
      via: 'api',
      attempt: async (ctx) => {
        const id = `env_${randomUUID()}`;
        sizes.set(id, [{ id: 'doc_1', bytes: 100 }]);
        const { call, forward } = gate(ctx, true);
        const body = { name: 'a.pdf', content: content(tooBig) };
        await expectForwarded(
          await call('PUT', `/api/v1/envelopes/${id}/documents/doc_1`, body),
          forward,
        );
      },
    },
    {
      id: 'files.replace.escaped',
      feature: 'fileBytes',
      via: 'api',
      attempt: async (ctx) => {
        const id = `env_${randomUUID()}`;
        sizes.set(id, [{ id: 'doc_1', bytes: 100 }]);
        const { call, forward } = gate(ctx, true);
        const body = { name: 'a.pdf', content: content(tooBig) };
        await expectForwarded(
          await call('PUT', `/api/v1/envelopes/${id}/%64ocuments/doc_1`, body),
          forward,
        );
      },
    },
    {
      id: 'storage.recall',
      feature: 'storageBytes',
      via: 'api',
      attempt: async (ctx) => {
        const id = `env_${randomUUID()}`;
        sizes.set(id, [{ id: 'doc_1', bytes: FREE_PLAN_LIMITS.storageBytes! + 1 }]);
        const { call, forward } = gate(ctx);
        await expectForwarded(await call('POST', `/api/v1/envelopes/${id}/recall`, {}), forward);
      },
    },
    {
      id: 'storage.revise',
      feature: 'storageBytes',
      via: 'api',
      attempt: async (ctx) => {
        const id = `env_${randomUUID()}`;
        sizes.set(id, [{ id: 'doc_1', bytes: FREE_PLAN_LIMITS.storageBytes! + 1 }]);
        const { call, forward } = gate(ctx);
        await expectForwarded(await call('POST', `/api/v1/envelopes/${id}/revise`), forward);
      },
    },
    {
      id: 'brand.domain',
      feature: 'customDomain',
      via: 'action',
      attempt: async (ctx) => {
        await updateSigningSettings(
          sql,
          ctx.ws.id,
          { ...signing, signingDomain: `sign-${randomUUID().slice(0, 8)}.example.in` },
          'localhost',
        );
      },
    },
    {
      id: 'brand.badge',
      feature: 'badgeRequired',
      via: 'action',
      attempt: async (ctx) => {
        await updateSigningSettings(sql, ctx.ws.id, { ...signing, showBadge: false }, 'localhost');
      },
    },
    {
      id: 'esign.own-account',
      feature: 'ownEsignAccount',
      via: 'action',
      attempt: (ctx) => assertOwnEsignAccount(sql, ctx.ws.id),
    },
  ];

  describe.each(CASES)('on %s', (kind) => {
    it.each(ENTRY_POINTS.map((entry) => [entry.id, entry] as const))(
      `${kind === 'free' ? 'refuses' : 'allows'} %s`,
      async (_id, entry) => {
        const ctx = await context(kind);
        const outcome = await entry.attempt(ctx).then(
          () => 'allowed' as const,
          (err: unknown) => {
            if (err instanceof PlanLimitError || err instanceof Refused) return 'refused' as const;
            throw err;
          },
        );
        expect(outcome).toBe(kind === 'free' ? 'refused' : 'allowed');
      },
    );
  });

  describe('counting', () => {
    it('counts a key call that the server then refuses, and not one the gate refused', async () => {
      const ctx = await context('free');
      const { call, forward } = gate(ctx, true);
      forward.mockResolvedValueOnce(new Response('{}', { status: 404 }));
      expect((await call('GET', '/api/v1/envelopes/missing')).status).toBe(404);
      expect(await usageOf(sql, ctx.ws.id, 'api_requests_month')).toBe(1);
      await useUpTo(ctx, FREE_PLAN_LIMITS.apiRequestsPerMonth!);
      expect((await call('GET', '/api/v1/envelopes')).status).toBe(429);
      expect(await usageOf(sql, ctx.ws.id, 'api_requests_month')).toBe(
        FREE_PLAN_LIMITS.apiRequestsPerMonth!,
      );
    });

    async function useUpTo(ctx: Ctx, total: number) {
      await sql`update app_usage set used = ${total}
        where workspace_id = ${ctx.ws.id} and metric = 'api_requests_month'`;
    }

    it('lets exactly the allowance through when key calls race', async () => {
      const ctx = await context('free');
      const { call, forward } = gate(ctx, true);
      const answers = await Promise.all(
        Array.from({ length: 130 }, () => call('GET', '/api/v1/envelopes')),
      );
      expect(answers.filter((r) => r.status === 201)).toHaveLength(100);
      expect(answers.filter((r) => r.status === 429)).toHaveLength(30);
      expect(forward).toHaveBeenCalledTimes(100);
    });

    it('starts the API count again on the 1st at midnight in India', async () => {
      const ctx = await context('free');
      let at = new Date('2026-11-30T18:29:59Z');
      const { call } = gate(ctx, true, () => at);
      const plan = { id: ctx.ws.id, ...(await workspacePlan(sql, ctx.ws.id, hosted)) };
      await reserveUsage(sql, plan, 'api_requests_month', 100, at);
      const refused = await call('GET', '/api/v1/envelopes');
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('1');
      const body = (await refused.json()) as { error: { details: { resetsAt: string } } };
      expect(body.error.details.resetsAt).toBe('2026-11-30T18:30:00.000Z');
      at = new Date('2026-11-30T18:30:00Z');
      expect((await call('GET', '/api/v1/envelopes')).status).toBe(201);
    });

    it('does not count a replayed send twice', async () => {
      const ctx = await context('free');
      const { call, forward } = gate(ctx);
      expect((await call('POST', '/api/v1/envelopes', draft)).status).toBe(201);
      forward.mockResolvedValueOnce(
        new Response('{}', { status: 201, headers: { 'idempotent-replayed': 'true' } }),
      );
      expect((await call('POST', '/api/v1/envelopes', draft)).status).toBe(201);
      expect(await usageOf(sql, ctx.ws.id, 'envelopes_sent')).toBe(1);
      expect(await usageOf(sql, ctx.ws.id, 'storage_bytes')).toBe(100);
    });

    it('counts what a replaced PDF adds and gives back what it frees', async () => {
      const ctx = await context('free');
      const id = `env_${randomUUID()}`;
      sizes.set(id, [
        { id: 'doc_1', bytes: 1000 },
        { id: 'doc_2', bytes: 500 },
      ]);
      const plan = { id: ctx.ws.id, ...(await workspacePlan(sql, ctx.ws.id, hosted)) };
      await reserveUsage(sql, plan, 'storage_bytes', 1500);
      const { call, forward } = gate(ctx);
      const replace = (bytes: number) =>
        call('PUT', `/api/v1/envelopes/${id}/documents/doc_1`, { content: content(bytes) });
      expect((await replace(1600)).status).toBe(201);
      expect(await usageOf(sql, ctx.ws.id, 'storage_bytes')).toBe(2100);
      expect((await replace(400)).status).toBe(201);
      expect(await usageOf(sql, ctx.ws.id, 'storage_bytes')).toBe(1500);
      forward.mockResolvedValueOnce(new Response('{}', { status: 409 }));
      expect((await replace(1900)).status).toBe(409);
      expect(await usageOf(sql, ctx.ws.id, 'storage_bytes')).toBe(1500);
      const whole = await replace(FREE_PLAN_LIMITS.envelopeBytes!);
      expect(whole.status).toBe(403);
      expect(
        ((await whole.json()) as { error: { details: { limit: string } } }).error.details,
      ).toMatchObject({
        limit: 'fileBytes',
      });
    });
  });

  describe('two at once', () => {
    it('gives the last template slot to one of several creates', async () => {
      const ctx = await context('free');
      await template(ctx, 'First');
      const results = await Promise.allSettled([1, 2, 3, 4].map((i) => template(ctx, `R${i}`)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('gives the last seat to one of several invitations', async () => {
      const ctx = await context('free');
      const results = await Promise.allSettled(
        ['a', 'b', 'c', 'd'].map((n) =>
          createInvitation(sql, {
            workspaceId: ctx.ws.id,
            email: `${n}@example.com`,
            role: 'member',
            invitedBy: { userId: ctx.owner.id, role: 'owner' },
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('gives the last seat to one of several people accepting', async () => {
      const ctx = await context('free');
      const people = await Promise.all([user('A'), user('B'), user('C')]);
      const tokens = await unlimited(ctx, async () => {
        const out = [];
        for (const person of people) {
          out.push(
            (
              await createInvitation(sql, {
                workspaceId: ctx.ws.id,
                email: person.email,
                role: 'member',
                invitedBy: { userId: ctx.owner.id, role: 'owner' },
              })
            ).token,
          );
        }
        return out;
      });
      const results = await Promise.allSettled(
        people.map((person, i) => acceptInvitation(sql, tokens[i]!, person)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from app_members where workspace_id = ${ctx.ws.id}`;
      expect(count?.n).toBe(2);
    });

    it('gives the last webhook endpoint of the fair-use cap to one of several creates', async () => {
      const ctx = await context('cloud');
      for (let i = 0; i < 9; i++) {
        await createWebhook(sql, { ...hook(i), workspaceId: ctx.ws.id, createdBy: ctx.owner.id });
      }
      const results = await Promise.allSettled(
        [1, 2, 3].map((i) =>
          createWebhook(sql, { ...hook(100 + i), workspaceId: ctx.ws.id, createdBy: ctx.owner.id }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('one account, several workspaces', () => {
    /** A second workspace on the same account, made while the plan allows it. */
    async function sibling(ctx: Ctx, name = 'Second') {
      const ws = await unlimited(ctx, () =>
        createWorkspace(sql, { name, userId: ctx.owner.id }, hosted),
      );
      expect(ws.accountId).toBe(ctx.ws.accountId);
      return { ...ctx, ws };
    }

    const invite = (ctx: Ctx, email = `${randomUUID().slice(0, 8)}@example.com`) =>
      createInvitation(sql, {
        workspaceId: ctx.ws.id,
        email,
        role: 'member',
        invitedBy: { userId: ctx.owner.id, role: 'owner' },
      });

    it('keeps the workspaces a Free account already has, and refuses another', async () => {
      const first = await context('free');
      const second = await sibling(first);
      await template(second, 'Still works');
      await expect(
        createWorkspace(sql, { name: 'Third', userId: first.owner.id }, hosted),
      ).rejects.toMatchObject({ limit: 'ownedWorkspaces', used: 2, max: 1 });
      const block = await newWorkspaceBlock(sql, first.owner.id, hosted);
      expect(block?.error.limit).toBe('ownedWorkspaces');
      expect(block?.slug).toBe(first.ws.slug);
      await setPlan(first.ws.slug, 'cloud');
      expect(await newWorkspaceBlock(sql, first.owner.id, hosted)).toBeNull();
      await createWorkspace(sql, { name: 'Third', userId: first.owner.id }, hosted);
    });

    it('counts a person once however many of the workspaces they are in', async () => {
      const first = await context('free');
      const second = await sibling(first);
      const person = await member(first.ws.id);
      await sql`insert into app_members (workspace_id, user_id, role)
        values (${second.ws.id}, ${person.id}, 'member')`;
      const report = await usageReport(sql, second.ws.id, hosted);
      expect(report.lines.find((l) => l.key === 'members')).toMatchObject({ used: 2, max: 2 });
      expect(report.lines.find((l) => l.key === 'ownedWorkspaces')).toMatchObject({ used: 2 });
      expect(report.workspaces.map((w) => [w.slug, w.members])).toEqual([
        [first.ws.slug, 2],
        [second.ws.slug, 2],
      ]);
      // Someone already counted can be invited to another workspace of the account.
      const third = await sibling(first, 'Third');
      await invite(third, person.email);
      // A new person cannot: the account's two places are taken.
      await expect(invite(third)).rejects.toMatchObject({ limit: 'members', used: 2, max: 2 });
    });

    it('counts an address invited to two workspaces once', async () => {
      const first = await context('cloud');
      vi.stubEnv('CLOUD_INCLUDED_MEMBERS', '3');
      const second = await sibling(first);
      await invite(first, 'both@example.com');
      await invite(second, 'both@example.com');
      const report = await usageReport(sql, first.ws.id, {
        ...hosted,
        cloudIncludedMembers: 3,
      });
      expect(report.lines.find((l) => l.key === 'members')).toMatchObject({ used: 2, max: 3 });
      await invite(second);
      await expect(invite(first)).rejects.toMatchObject({ limit: 'members' });
      // At the limit, an address that already holds a place can still be invited elsewhere.
      const third = await sibling(first, 'Third');
      await invite(third, 'both@example.com');
    });

    it('gives the last seat to one of two invitations sent from different workspaces', async () => {
      const first = await context('free');
      const second = await sibling(first);
      const results = await Promise.allSettled([invite(first), invite(second)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(PlanLimitError);
    });

    it('gives the last seat to one of two people joining different workspaces', async () => {
      const first = await context('free');
      const second = await sibling(first);
      const people = [await user('A'), await user('B')];
      const tokens = await unlimited(first, async () => [
        (await invite(first, people[0]!.email)).token,
        (await invite(second, people[1]!.email)).token,
      ]);
      const results = await Promise.allSettled(
        people.map((person, i) => acceptInvitation(sql, tokens[i]!, person)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('shares the template limit and gives the last place to one of two workspaces', async () => {
      const first = await context('free');
      const second = await sibling(first);
      await template(first, 'One');
      const results = await Promise.allSettled([template(first, 'A'), template(second, 'B')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await expect(template(second, 'C')).rejects.toMatchObject({
        limit: 'activeTemplates',
        used: 2,
        max: 2,
      });
    });

    it('lets exactly the allowance through when key calls race in two workspaces', async () => {
      const first = await context('free');
      const second = await sibling(first);
      const one = gate(first, true);
      const two = gate(second, true);
      const answers = await Promise.all(
        Array.from({ length: 130 }, (_, i) => (i % 2 ? one : two).call('GET', '/api/v1/envelopes')),
      );
      expect(answers.filter((r) => r.status === 201)).toHaveLength(100);
      expect(answers.filter((r) => r.status === 429)).toHaveLength(30);
      expect(
        (await usageOf(sql, first.ws.id, 'api_requests_month')) +
          (await usageOf(sql, second.ws.id, 'api_requests_month')),
      ).toBe(100);
    });

    it('shares the monthly envelopes, so a second workspace cannot send past them', async () => {
      const first = await context('free');
      const second = await sibling(first);
      await useUp(first, 'envelopes_sent', FREE_PLAN_LIMITS.envelopesPerMonth!);
      const { call, forward } = gate(second);
      const refused = await call('POST', '/api/v1/envelopes', draft);
      expect(refused.status).toBe(403);
      expect(forward).not.toHaveBeenCalled();
      expect(
        ((await refused.json()) as { error: { details: { limit: string; used: number } } }).error
          .details,
      ).toMatchObject({ limit: 'envelopesPerMonth', used: FREE_PLAN_LIMITS.envelopesPerMonth });
    });

    it('pauses webhooks and the own eSign account in every workspace when the account leaves Cloud', async () => {
      const first = await context('cloud');
      const second = await sibling(first);
      for (const ctx of [first, second]) {
        await createWebhook(sql, { ...hook(1), workspaceId: ctx.ws.id, createdBy: ctx.owner.id });
        expect(await webhookTargetsFor(sql, ctx.ws.id)).toHaveLength(1);
        await assertOwnEsignAccount(sql, ctx.ws.id, hosted);
      }
      await setPlan(second.ws.slug, 'free');
      for (const ctx of [first, second]) {
        expect(await webhookTargetsFor(sql, ctx.ws.id)).toEqual([]);
        await expect(assertOwnEsignAccount(sql, ctx.ws.id, hosted)).rejects.toBeInstanceOf(
          PlanLimitError,
        );
        expect((await workspacePlan(sql, ctx.ws.id, hosted)).plan).toBe('free');
      }
    });

    it('counts a guest against the account they are invited into, not their own', async () => {
      const host = await context('free');
      const guest = await context('free');
      const { token } = await invite(host, guest.owner.email);
      await acceptInvitation(sql, token, guest.owner);
      const hosts = await usageReport(sql, host.ws.id, hosted);
      const guests = await usageReport(sql, guest.ws.id, hosted);
      expect(hosts.lines.find((l) => l.key === 'members')?.used).toBe(2);
      expect(guests.lines.find((l) => l.key === 'members')?.used).toBe(1);
      expect(guests.lines.find((l) => l.key === 'ownedWorkspaces')?.used).toBe(1);
      // Being made an owner there moves nothing: the workspace stays on the host's account.
      await changeRole(sql, {
        workspaceId: host.ws.id,
        actor: { userId: host.owner.id, role: 'owner' },
        userId: guest.owner.id,
        role: 'owner',
      });
      expect((await workspaceEntitlements(sql, host.ws.id, hosted)).accountId).toBe(
        host.ws.accountId,
      );
      await expect(
        createWorkspace(sql, { name: 'More', userId: guest.owner.id }, hosted),
      ).rejects.toMatchObject({ limit: 'ownedWorkspaces', used: 1 });
    });

    it('keeps the person whose account it is as an owner of the workspace', async () => {
      const ctx = await context('free');
      const other = await member(ctx.ws.id, 'owner');
      const actor = { userId: other.id, role: 'owner' as const };
      await expect(
        changeRole(sql, { workspaceId: ctx.ws.id, actor, userId: ctx.owner.id, role: 'admin' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        removeMember(sql, { workspaceId: ctx.ws.id, actor, userId: ctx.owner.id }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        removeMember(sql, {
          workspaceId: ctx.ws.id,
          actor: { userId: ctx.owner.id, role: 'owner' },
          userId: ctx.owner.id,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('a workspace that is over the Free limits', () => {
    async function grown() {
      const ctx = await context('cloud');
      const members = [await member(ctx.ws.id), await member(ctx.ws.id), await member(ctx.ws.id)];
      const templates = [];
      for (let i = 0; i < 4; i++) templates.push(await template(ctx, `Kept ${i}`));
      const hooks = [
        await createWebhook(sql, { ...hook(1), workspaceId: ctx.ws.id, createdBy: ctx.owner.id }),
        await createWebhook(sql, { ...hook(2), workspaceId: ctx.ws.id, createdBy: ctx.owner.id }),
      ];
      await updateSigningSettings(sql, ctx.ws.id, { ...signing, showBadge: false }, 'localhost');
      await setPlan(ctx.ws.slug, 'free');
      return { ctx: { ...ctx, kind: 'free' as const }, members, templates, hooks };
    }

    it('keeps its members, templates and endpoints, and adds nothing', async () => {
      const { ctx, templates } = await grown();
      const [counts] = await sql<{ members: number; templates: number }[]>`select
        (select count(*)::int from app_members where workspace_id = ${ctx.ws.id}) as members,
        (select count(*)::int from app_templates where workspace_id = ${ctx.ws.id}
          and archived_at is null) as templates`;
      expect(counts).toEqual({ members: 4, templates: 4 });
      expect(await listWebhooks(sql, ctx.ws.id)).toHaveLength(2);

      const refused = async (work: Promise<unknown>) =>
        expect(
          await work.then(
            () => null,
            (e: unknown) => e,
          ),
        ).toBeInstanceOf(PlanLimitError);
      await refused(
        createInvitation(sql, {
          workspaceId: ctx.ws.id,
          email: 'more@example.com',
          role: 'member',
          invitedBy: { userId: ctx.owner.id, role: 'owner' },
        }),
      );
      await refused(template(ctx, 'More'));
      await refused(
        duplicateTemplate(sql, files, {
          workspaceId: ctx.ws.id,
          id: templates[0]!.id,
          createdBy: ctx.owner.id,
        }),
      );
      // Archiving is always possible; coming back needs room under the limit.
      await setTemplateArchived(sql, ctx.ws.id, templates[0]!.id, true);
      await refused(setTemplateArchived(sql, ctx.ws.id, templates[0]!.id, false));
    });

    it('pauses its webhooks and its own eSign account until it is on Cloud again', async () => {
      const { ctx, hooks } = await grown();
      expect(await webhookTargetsFor(sql, ctx.ws.id)).toEqual([]);
      const rights = await workspaceEntitlements(sql, ctx.ws.id);
      expect(rights).toMatchObject({ webhooks: false, ownEsignAccount: false, plan: 'free' });
      // Turning one off and removing it stay possible.
      await setWebhookEnabled(sql, ctx.ws.id, hooks[0]!.id, false);
      await expect(setWebhookEnabled(sql, ctx.ws.id, hooks[0]!.id, true)).rejects.toBeInstanceOf(
        PlanLimitError,
      );
      await setPlan(ctx.ws.slug, 'cloud');
      expect(await webhookTargetsFor(sql, ctx.ws.id)).toHaveLength(1);
      expect(await workspaceEntitlements(sql, ctx.ws.id)).toMatchObject({
        webhooks: true,
        ownEsignAccount: true,
      });
    });

    it('counts paid members on Cloud and drops them with the plan', async () => {
      const ctx = await context('cloud');
      vi.stubEnv('CLOUD_INCLUDED_MEMBERS', '2');
      await member(ctx.ws.id);
      const invite = () =>
        createInvitation(sql, {
          workspaceId: ctx.ws.id,
          email: `${randomUUID().slice(0, 8)}@example.com`,
          role: 'member',
          invitedBy: { userId: ctx.owner.id, role: 'owner' },
        });
      await expect(invite()).rejects.toBeInstanceOf(PlanLimitError);
      await sql`update app_accounts set extra_seats = 1 where id = ${ctx.ws.accountId}`;
      await invite();
      await expect(invite()).rejects.toBeInstanceOf(PlanLimitError);
    });
  });

  describe('self-hosted', () => {
    it('has no limits and no billing', async () => {
      const ctx = await context('self-hosted');
      const rights = await workspaceEntitlements(sql, ctx.ws.id);
      expect(rights.billingVisible).toBe(false);
      expect(rights.plan).toBe('unlimited');
      expect(Object.values(rights.limits).filter((v) => typeof v === 'number')).toEqual([]);
      const { call, forward } = gate(ctx, true);
      for (let i = 0; i < 120; i++) await call('GET', '/api/v1/envelopes');
      expect(forward).toHaveBeenCalledTimes(120);
      expect(await usageOf(sql, ctx.ws.id, 'api_requests_month')).toBe(0);
    });
  });
});

const SRC = join(import.meta.dirname, '..', 'src');
const read = (path: string) => readFileSync(path, 'utf8');

/**
 * Every server action, with the check that applies the plan to it or the reason it needs
 * none. `enforcedBy` is a function the action's file must call; each is one the matrix above
 * exercises.
 */
const ACTIONS: Record<string, { entry: string; enforcedBy: string } | { free: string }> = {
  // account, personal
  setPasswordAction: { free: 'the person, not a workspace' },
  signOutOtherSessionsAction: { free: 'the person, not a workspace' },
  signOutEverywhereAction: { free: 'the person, not a workspace' },
  joinWithPasswordAction: { free: 'makes the account only; joining is acceptInvitationAction' },
  updatePreferencesAction: { free: 'the person, not a workspace' },
  updateNameAction: { free: 'the person, not a workspace' },
  recordTourAction: { free: 'the person, not a workspace' },
  // api keys
  createApiKeyAction: { free: 'keys are free to make; each call is counted by api.requests' },
  revokeApiKeyAction: { free: 'removes' },
  // aadhaar esign
  setEsignModeAction: { entry: 'esign.own-account', enforcedBy: 'assertOwnEsignAccount' },
  saveEsignCredentialsAction: { entry: 'esign.own-account', enforcedBy: 'assertOwnEsignAccount' },
  removeEsignCredentialsAction: { free: 'removes' },
  testEsignConnectionAction: { free: 'a read-only check of details already saved' },
  // billing
  saveBillingDetailsAction: { free: 'billing itself' },
  createCreditsOrderAction: { free: 'a purchase; open to every plan' },
  confirmPaymentAction: { free: 'a purchase; open to every plan' },
  listInvoicesAction: { free: 'reads' },
  creditHistoryAction: { free: 'reads' },
  startSubscriptionAction: { free: 'a purchase; how a workspace moves to Cloud' },
  addSeatsAction: { free: 'a purchase; raises the member limit once paid' },
  scheduleCancelAction: { free: 'ends a paid plan; adds nothing' },
  setRenewalSeatsAction: { free: 'sets what the next term is charged for; adds nothing now' },
  bookInstallHelpAction: { free: 'a public purchase; no workspace' },
  confirmInstallHelpAction: { free: 'a public purchase; no workspace' },
  // brand
  updateBrandAction: { free: 'logo, colour and font are part of every plan' },
  uploadLogoAction: { free: 'logo, colour and font are part of every plan' },
  removeLogoAction: { free: 'removes' },
  updateEmailSettingsAction: { free: 'email wording is part of every plan' },
  updateSigningSettingsAction: { entry: 'brand.domain', enforcedBy: 'updateSigningSettings' },
  // envelopes
  inspectDocumentAction: { entry: 'files.create', enforcedBy: 'assertWithin' },
  voidEnvelopesAction: { free: 'ends an envelope' },
  remindAction: { free: 'no plan number for reminders' },
  verifyDocumentAction: { free: 'reads' },
  shareLinkAction: { free: 'no plan number for links' },
  correctRecipientAction: { free: 'no plan number for corrections' },
  recallEnvelopeAction: { entry: 'storage.recall', enforcedBy: 'signApi' },
  reviseEnvelopeAction: { entry: 'storage.revise', enforcedBy: 'signApi' },
  replaceDocumentAction: { entry: 'files.replace', enforcedBy: 'signApi' },
  // public records
  setRecordRevokedAction: { free: 'part of every plan' },
  setPublicRecordsAction: { free: 'part of every plan' },
  // team
  inviteMemberAction: { entry: 'members.invite', enforcedBy: 'createInvitation' },
  revokeInvitationAction: { free: 'removes' },
  changeRoleAction: { free: 'a role inside a workspace; the workspace stays on its account' },
  removeMemberAction: { free: 'removes' },
  leaveWorkspaceAction: { free: 'removes' },
  acceptInvitationAction: { entry: 'members.accept', enforcedBy: 'acceptInvitation' },
  // templates
  stageTemplateDocumentAction: { entry: 'files.create', enforcedBy: 'assertWithin' },
  createTemplateAction: { entry: 'templates.create', enforcedBy: 'createTemplate' },
  updateTemplateAction: { free: 'edits a template the workspace already has' },
  duplicateTemplateAction: { entry: 'templates.duplicate', enforcedBy: 'duplicateTemplate' },
  archiveTemplateAction: { entry: 'templates.restore', enforcedBy: 'setTemplateArchived' },
  sendTemplateAction: { entry: 'envelopes.from-template', enforcedBy: 'sendFromTemplate' },
  startBulkSendAction: { entry: 'bulk.rows', enforcedBy: 'assertWithin' },
  bulkSendStatusAction: { free: 'reads' },
  cancelBulkSendAction: { free: 'stops a send' },
  // webhooks
  createWebhookAction: { entry: 'webhooks.create', enforcedBy: 'createWebhook' },
  updateWebhookAction: { free: 'edits an endpoint the workspace already has; it stays paused' },
  setWebhookEnabledAction: { entry: 'webhooks.enable', enforcedBy: 'setWebhookEnabled' },
  rollWebhookSecretAction: { free: 'replaces a secret; the endpoint stays paused' },
  deleteWebhookAction: { free: 'removes' },
  testWebhookAction: { entry: 'webhooks.send', enforcedBy: 'assertWebhooksLive' },
  retryDeliveryAction: { entry: 'webhooks.send', enforcedBy: 'assertWebhooksLive' },
  // workspace
  createWorkspaceAction: { entry: 'owners.create', enforcedBy: 'createWorkspace' },
  // workspace transfers
  startTransferAction: { entry: 'owners.transfer', enforcedBy: 'startTransfer' },
  acceptTransferAction: { entry: 'owners.transfer', enforcedBy: 'acceptTransfer' },
  cancelTransferAction: { free: 'withdraws an offer' },
  declineTransferAction: { free: 'turns an offer down' },
  dismissStartHereAction: { free: 'a preference' },
  renameWorkspaceAction: { free: 'part of every plan' },
  setWorkspaceTimeZoneAction: { free: 'part of every plan' },
  changeWorkspaceAddressAction: { free: 'part of every plan' },
};

/**
 * Every route of the sign API that changes something, with the gate's rule for it or the
 * reason it needs none. Files of routes the person signing uses, or anyone, are listed whole.
 */
const ROUTE_FILES: Record<string, 'sender' | string> = {
  'sender.ts': 'sender',
  'revisions.ts': 'sender',
  'templates.ts': 'sender',
  'signer.ts': 'the person signing: no workspace plan applies to a signature',
  'receipt.ts': 'the person signing',
  'link.ts': 'the person signing',
  'copy.ts': 'a download link from an email',
  'verify.ts': 'public verification, limited per address',
  'esign.ts': 'the eSign provider calling back',
  'openapi.ts': 'the API description',
};

const SENDER_ROUTES: Record<string, { entry: string } | { free: string }> = {
  'sender.ts POST /': { entry: 'envelopes.create' },
  'sender.ts PATCH /:id': { free: 'edits a draft; no new file' },
  'sender.ts POST /:id/send': { entry: 'envelopes.send' },
  'sender.ts POST /:id/void': { free: 'ends an envelope' },
  'sender.ts POST /:id/remind': { free: 'no plan number for reminders' },
  'revisions.ts POST /:id/recipients/:recipientId/link': { free: 'no plan number for links' },
  'revisions.ts PATCH /:id/recipients/:recipientId': { free: 'no plan number for corrections' },
  'revisions.ts POST /:id/recall': { entry: 'storage.recall' },
  'revisions.ts POST /:id/revise': { entry: 'storage.revise' },
  'revisions.ts PUT /:id/documents/:docId': { entry: 'files.replace' },
  'templates.ts POST /': { entry: 'templates.create' },
  'templates.ts PATCH /:templateId': { free: 'edits a template the workspace already has' },
  'templates.ts DELETE /:templateId': { free: 'removes' },
  'templates.ts POST /:templateId/envelopes': { entry: 'envelopes.from-template' },
};

describe('no entry point is left out of the matrix', () => {
  const matrix = read(join(import.meta.dirname, 'plan-matrix.db.test.ts'));
  const entryIds = new Set([...matrix.matchAll(/^\s+id: '([a-z.-]+)',$/gm)].map((m) => m[1]!));

  it('classifies every server action', () => {
    const dir = join(SRC, 'server', 'actions');
    const found = new Map<string, string>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'action.ts') continue;
      const source = read(join(dir, file));
      for (const match of source.matchAll(/export const (\w+Action)\b/g)) {
        found.set(match[1]!, source);
      }
    }
    expect([...found.keys()].sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const [name, rule] of Object.entries(ACTIONS)) {
      if ('free' in rule) continue;
      expect(entryIds, `${name} names an entry point of the matrix`).toContain(rule.entry);
      expect(found.get(name), `${name} goes through ${rule.enforcedBy}`).toContain(
        `${rule.enforcedBy}(`,
      );
    }
  });

  it('classifies every changing route of the sign API', () => {
    const dir = join(SRC, '..', '..', '..', 'packages', 'server', 'src', 'routes');
    const files = readdirSync(dir).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    const routed = files.filter((file) =>
      /\bapp\.(get|post|put|patch|delete)\(/.test(read(join(dir, file))),
    );
    for (const file of routed) expect(Object.keys(ROUTE_FILES), file).toContain(file);
    const found: string[] = [];
    for (const file of routed.filter((f) => ROUTE_FILES[f] === 'sender')) {
      for (const match of read(join(dir, file)).matchAll(
        /\bapp\.(post|put|patch|delete)\(\s*'([^']+)'/g,
      )) {
        found.push(`${file} ${match[1]!.toUpperCase()} ${match[2]}`);
      }
    }
    expect(found.sort()).toEqual(Object.keys(SENDER_ROUTES).sort());
    for (const rule of Object.values(SENDER_ROUTES)) {
      if ('entry' in rule) expect(entryIds).toContain(rule.entry);
    }
  });

  it('sends every call of the sign API through the gate', () => {
    const calls: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/\.app\.fetch\(/.test(read(path))) calls.push(path.slice(SRC.length + 1));
        }
      }
    };
    walk(SRC);
    expect(calls).toEqual(['server/sign/server.ts']);
    const server = read(join(SRC, 'server', 'sign', 'server.ts'));
    expect(server.match(/\.app\.fetch\(/g)).toHaveLength(2);
    expect(server).toContain(
      "if (planSettings().mode === 'self-hosted') return signServer().app.fetch(request);",
    );
    expect(server).toContain('return gate()(request, async (r) => signServer().app.fetch(r));');
  });

  it('lets only the account owner, or a billing admin for billing, reach what an account holds', () => {
    // Billing, credits, the subscription and the own eSign account belong to an account. An
    // action on any of them must go through `accountAction`, never `workspaceAction` alone.
    const dir = join(SRC, 'server', 'actions');
    const loose: string[] = [];
    for (const file of readdirSync(dir).filter((n) => /\.ts$/.test(n) && !/\.test\./.test(n))) {
      const source = read(join(dir, file));
      for (const match of source.matchAll(/(\w+)\(\s*'(billing|esign)\.manage'/g)) {
        if (match[1] !== 'accountAction') loose.push(`${file}: ${match[1]}('${match[2]}.manage')`);
      }
    }
    expect(loose).toEqual([]);
    const route = read(
      join(SRC, 'app/api/billing/workspaces/[workspaceId]/invoices/[invoiceId]/route.ts'),
    );
    expect(route).toContain(
      'if (!canManageBilling(membership.role, account.ownerUserId === user.id)) {',
    );
    // Billing exists on the hosted cloud only; a self-hosted install answers 404 everywhere.
    expect(route).toContain('if (!isHosted()) return notFound();');
    expect(read(join(SRC, 'app/api/billing/razorpay/webhook/route.ts'))).toContain(
      'if (!isHosted()) return answer(404',
    );
    const billing = read(join(dir, 'billing.ts'));
    expect(billing).toContain("if (!isHosted()) throw new AppError('NOT_FOUND', 'Not found');");
    expect(billing.match(/accountAction\(/g)).toHaveLength(1);
    for (const file of ['subscriptions.ts', 'install-help.ts']) {
      expect(read(join(dir, file)), file).toContain('isHosted()');
    }
    for (const page of ['billing', 'plan', 'aadhaar-esign']) {
      const source = read(join(SRC, `app/dashboard/[slug]/settings/${page}/page.tsx`));
      expect(source, page).toMatch(/isAccountOwner|ownerUserId/);
    }
  });
});
