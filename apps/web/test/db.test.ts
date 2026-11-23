import { randomUUID } from 'node:crypto';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  postgresStore,
  type PdfEngine,
} from '@codevibe_technology/sign-server';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG } from './fixtures';
import { createApiKey, listApiKeys, resolveApiKey, revokeApiKey } from '@/server/api-keys';
import { authOptions } from '@/server/auth/config';
import {
  getBrand,
  getSigningBrand,
  readLogo,
  removeLogo,
  setLogo,
  updateBrand,
  updateEmailSettings,
  updateSigningSettings,
} from '@/server/brand';
import { AppError } from '@/server/errors';
import {
  acceptInvitation,
  createInvitation,
  findInvitation,
  listOpenInvitations,
  revokeInvitation,
} from '@/server/invitations';
import { changeRole, listMembers, removeMember } from '@/server/members';
import { migrateAll } from '@/server/migrate';
import { getPreferences, updatePreferences } from '@/server/preferences';
import {
  envelopeCounts,
  findSealedDocument,
  recentActivity,
  recordSender,
  senderOf,
  sentBy,
  waitingOn,
} from '@/server/envelopes';
import { createAuthenticate } from '@/server/sign/principal';
import {
  createWorkspace,
  findMembership,
  listWorkspacesForUser,
  renameWorkspace,
  setWorkspaceTimeZone,
  workspaceTimeZone,
} from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const APP_URL = 'http://localhost:3000';
const SECRET = 'test-secret-0123456789abcdef0123456789';

async function rejectsWith(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

describe.skipIf(!url)('against PostgreSQL', () => {
  const schema = `web_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let users: Record<'asha' | 'ravi' | 'mia' | 'zoe', { id: string; email: string }>;

  async function user(name: string) {
    const id = randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id, email };
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    const runs = await Promise.all([migrateAll(sql), migrateAll(sql)]);
    expect(runs.flat()).toContain('app/0002_workspaces');
    expect(runs.flat()).toContain('app/0003_envelope_senders');
    expect(runs.flat()).toContain('0003_workspaces');
    users = {
      asha: await user('Asha'),
      ravi: await user('Ravi'),
      mia: await user('Mia'),
      zoe: await user('Zoe'),
    };
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  it('migrates once and is then up to date', async () => {
    expect(await migrateAll(sql)).toEqual([]);
  });

  describe('Better Auth', () => {
    const options = (send: (email: string, link: string) => Promise<void>) =>
      authOptions({ sql, appUrl: APP_URL, secret: SECRET, sendMagicLink: send });

    it('finds every table and column it needs in our migration', async () => {
      const plan = await getMigrations(options(async () => undefined));
      expect(plan.toBeCreated.map((t) => t.table)).toEqual([]);
      expect(plan.toBeAdded.map((t) => [t.table, Object.keys(t.fields)])).toEqual([]);
    });

    it('signs a new person in with a magic link', async () => {
      const links: string[] = [];
      const auth = betterAuth(options(async (_email, link) => void links.push(link)));
      const email = `new-${randomUUID().slice(0, 6)}@example.com`;
      const sent = await auth.handler(
        new Request(`${APP_URL}/api/auth/sign-in/magic-link`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: APP_URL },
          body: JSON.stringify({ email, callbackURL: '/' }),
        }),
      );
      expect(sent.status).toBe(200);
      expect(links).toHaveLength(1);
      const [stored] = await sql`select value from auth_verifications`;
      expect(JSON.stringify(stored)).not.toContain(new URL(links[0]!).searchParams.get('token'));

      const verified = await auth.handler(new Request(links[0]!));
      expect([200, 302]).toContain(verified.status);
      const cookie = verified.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/cvs\.session_token=/);
      expect(cookie).toMatch(/HttpOnly/i);
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: cookie.split(';')[0]! }),
      });
      expect(session?.user.email).toBe(email);

      const reused = await auth.handler(new Request(links[0]!));
      expect(reused.headers.get('set-cookie') ?? '').not.toMatch(/cvs\.session_token=[^;]+/);
    });
  });

  describe('workspaces and members', () => {
    it('creates a workspace with its creator as owner and a unique slug', async () => {
      const a = await createWorkspace(sql, { name: 'Acme HR', userId: users.asha.id });
      const b = await createWorkspace(sql, { name: 'Acme  HR', userId: users.ravi.id });
      expect(a.slug).toMatch(/^acme-hr/);
      expect(b.slug).not.toBe(a.slug);
      expect(await findMembership(sql, users.asha.id, { slug: a.slug })).toMatchObject({
        role: 'owner',
      });
      expect(await findMembership(sql, users.asha.id, { slug: b.slug })).toBeNull();
      expect(await findMembership(sql, users.ravi.id, { id: a.id })).toBeNull();
      expect((await getBrand(sql, a.id)).brandColor).toBe('#1B6AE0');
      const mine = await listWorkspacesForUser(sql, users.asha.id);
      expect(mine.map((m) => m.workspace.id)).toContain(a.id);
      expect(mine.map((m) => m.workspace.id)).not.toContain(b.id);
      await rejectsWith(createWorkspace(sql, { name: '   ', userId: users.asha.id }), 'VALIDATION');
      expect(await renameWorkspace(sql, a.id, '  Acme   People ')).toBe('Acme People');
    });

    it('keeps an owner and checks who may change whom', async () => {
      const ws = await createWorkspace(sql, { name: 'Roles', userId: users.asha.id });
      const owner = { userId: users.asha.id, role: 'owner' as const };
      await sql`insert into app_members (workspace_id, user_id, role)
        values (${ws.id}, ${users.ravi.id}, 'admin'), (${ws.id}, ${users.mia.id}, 'member')`;
      const admin = { userId: users.ravi.id, role: 'admin' as const };

      await rejectsWith(
        changeRole(sql, { workspaceId: ws.id, actor: owner, userId: users.asha.id, role: 'admin' }),
        'CONFLICT',
      );
      await rejectsWith(
        removeMember(sql, { workspaceId: ws.id, actor: owner, userId: users.asha.id }),
        'CONFLICT',
      );
      await rejectsWith(
        changeRole(sql, { workspaceId: ws.id, actor: admin, userId: users.mia.id, role: 'owner' }),
        'FORBIDDEN',
      );
      await rejectsWith(
        removeMember(sql, { workspaceId: ws.id, actor: admin, userId: users.asha.id }),
        'FORBIDDEN',
      );
      await changeRole(sql, {
        workspaceId: ws.id,
        actor: admin,
        userId: users.mia.id,
        role: 'viewer',
      });
      await rejectsWith(
        changeRole(sql, { workspaceId: ws.id, actor: owner, userId: users.zoe.id, role: 'viewer' }),
        'NOT_FOUND',
      );

      await changeRole(sql, {
        workspaceId: ws.id,
        actor: owner,
        userId: users.ravi.id,
        role: 'owner',
      });
      await changeRole(sql, {
        workspaceId: ws.id,
        actor: owner,
        userId: users.asha.id,
        role: 'member',
      });
      expect((await listMembers(sql, ws.id)).map((m) => [m.name, m.role])).toEqual([
        ['Ravi', 'owner'],
        ['Asha', 'member'],
        ['Mia', 'viewer'],
      ]);
      await removeMember(sql, {
        workspaceId: ws.id,
        actor: { userId: users.mia.id, role: 'viewer' },
        userId: users.mia.id,
      });
      expect(await findMembership(sql, users.mia.id, { id: ws.id })).toBeNull();
    });

    it('never lets two requests remove the last two owners together', async () => {
      const ws = await createWorkspace(sql, { name: 'Race', userId: users.asha.id });
      await sql`insert into app_members (workspace_id, user_id, role) values (${ws.id}, ${users.ravi.id}, 'owner')`;
      const results = await Promise.allSettled([
        removeMember(sql, {
          workspaceId: ws.id,
          actor: { userId: users.asha.id, role: 'owner' },
          userId: users.ravi.id,
        }),
        removeMember(sql, {
          workspaceId: ws.id,
          actor: { userId: users.ravi.id, role: 'owner' },
          userId: users.asha.id,
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await listMembers(sql, ws.id)).filter((m) => m.role === 'owner')).toHaveLength(1);
    });
  });

  describe('invitations', () => {
    it('invites by email, accepts once, and only for that email', async () => {
      const ws = await createWorkspace(sql, { name: 'Invites', userId: users.asha.id });
      const inviter = { userId: users.asha.id, role: 'owner' as const };
      const first = await createInvitation(sql, {
        workspaceId: ws.id,
        email: users.mia.email.toUpperCase(),
        role: 'member',
        invitedBy: inviter,
      });
      const again = await createInvitation(sql, {
        workspaceId: ws.id,
        email: users.mia.email,
        role: 'viewer',
        invitedBy: inviter,
      });
      expect(await findInvitation(sql, first.token)).toMatchObject({ revokedAt: expect.any(Date) });
      expect((await listOpenInvitations(sql, ws.id)).map((i) => [i.email, i.role])).toEqual([
        [users.mia.email, 'viewer'],
      ]);
      const [stored] =
        await sql`select token_hash from app_invitations where id = ${again.invitation.id}`;
      expect(stored?.token_hash).not.toBe(again.token);

      await rejectsWith(acceptInvitation(sql, again.token, users.zoe), 'FORBIDDEN');
      await rejectsWith(acceptInvitation(sql, first.token, users.mia), 'NOT_FOUND');
      expect(await acceptInvitation(sql, again.token, users.mia)).toEqual({
        workspaceSlug: ws.slug,
      });
      expect(await findMembership(sql, users.mia.id, { id: ws.id })).toMatchObject({
        role: 'viewer',
      });
      await rejectsWith(acceptInvitation(sql, again.token, users.mia), 'NOT_FOUND');
      await rejectsWith(
        createInvitation(sql, {
          workspaceId: ws.id,
          email: users.mia.email,
          role: 'member',
          invitedBy: inviter,
        }),
        'CONFLICT',
      );
    });

    it('refuses expired, withdrawn and malformed invitations', async () => {
      const ws = await createWorkspace(sql, { name: 'Expiry', userId: users.asha.id });
      const inviter = { userId: users.asha.id, role: 'owner' as const };
      const old = await createInvitation(sql, {
        workspaceId: ws.id,
        email: users.zoe.email,
        role: 'member',
        invitedBy: inviter,
        now: new Date(Date.now() - 8 * 86_400_000),
      });
      await rejectsWith(acceptInvitation(sql, old.token, users.zoe), 'NOT_FOUND');
      const fresh = await createInvitation(sql, {
        workspaceId: ws.id,
        email: users.zoe.email,
        role: 'member',
        invitedBy: inviter,
      });
      await rejectsWith(revokeInvitation(sql, 'ws_other', fresh.invitation.id), 'NOT_FOUND');
      await revokeInvitation(sql, ws.id, fresh.invitation.id);
      await rejectsWith(acceptInvitation(sql, fresh.token, users.zoe), 'NOT_FOUND');
      expect(await findInvitation(sql, "x' or 1=1 --")).toBeNull();
      await rejectsWith(
        createInvitation(sql, {
          workspaceId: ws.id,
          email: 'x@y.co',
          role: 'owner',
          invitedBy: { userId: users.asha.id, role: 'admin' },
        }),
        'FORBIDDEN',
      );
      await rejectsWith(
        createInvitation(sql, {
          workspaceId: ws.id,
          email: 'not an email',
          role: 'member',
          invitedBy: inviter,
        }),
        'VALIDATION',
      );
    });
  });

  describe('API keys', () => {
    it('stores only a hash, resolves to its workspace and stops when revoked', async () => {
      const a = await createWorkspace(sql, { name: 'Keys A', userId: users.asha.id });
      const b = await createWorkspace(sql, { name: 'Keys B', userId: users.ravi.id });
      const key = await createApiKey(sql, {
        workspaceId: a.id,
        name: 'CI',
        createdBy: users.asha.id,
      });
      expect(key.key).toMatch(/^cvs_[A-Za-z0-9_-]{43}$/);
      const rows = await sql`select * from app_api_keys where id = ${key.id}`;
      expect(JSON.stringify(rows)).not.toContain(key.key);

      expect(await resolveApiKey(sql, key.key)).toEqual({ id: key.id, workspaceId: a.id });
      const altered = `${key.key.slice(0, -1)}${key.key.endsWith('A') ? 'B' : 'A'}`;
      expect(await resolveApiKey(sql, altered)).toBeNull();
      expect(await resolveApiKey(sql, 'Bearer nonsense')).toBeNull();
      expect((await listApiKeys(sql, a.id))[0]).toMatchObject({
        name: 'CI',
        lastUsedAt: expect.any(Date),
      });
      expect(await listApiKeys(sql, b.id)).toEqual([]);

      await rejectsWith(revokeApiKey(sql, b.id, key.id), 'NOT_FOUND');
      expect(await resolveApiKey(sql, key.key)).not.toBeNull();
      await revokeApiKey(sql, a.id, key.id);
      expect(await resolveApiKey(sql, key.key)).toBeNull();
      expect(await listApiKeys(sql, a.id)).toEqual([]);
    });
  });

  describe('brand and preferences', () => {
    it('saves brand settings and the logo per workspace', async () => {
      const a = await createWorkspace(sql, { name: 'Brand A', userId: users.asha.id });
      const b = await createWorkspace(sql, { name: 'Brand B', userId: users.asha.id });
      const files = memoryFileStore();
      await updateBrand(sql, a.id, {
        brandColor: '#2dd4bf',
        font: 'serif',
        senderName: 'Acme "HR"\n',
      });
      expect(await getBrand(sql, a.id)).toMatchObject({
        brandColor: '#2DD4BF',
        font: 'serif',
        senderName: 'Acme HR',
      });
      expect((await getBrand(sql, b.id)).brandColor).toBe('#1B6AE0');
      await rejectsWith(updateBrand(sql, a.id, { brandColor: 'teal' }), 'VALIDATION');

      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      await setLogo(sql, files, a.id, png);
      expect((await getBrand(sql, a.id)).logoUrl).toMatch(
        new RegExp(`^/brand/${a.id}/logo\\?v=\\d+$`),
      );
      expect(await readLogo(sql, files, a.id)).toEqual({ bytes: png, type: 'image/png' });
      expect(await readLogo(sql, files, b.id)).toBeNull();
      await removeLogo(sql, files, a.id);
      expect((await getBrand(sql, a.id)).logoUrl).toBeNull();
    });

    it('saves email settings and template overrides', async () => {
      const a = await createWorkspace(sql, { name: 'Mail A', userId: users.asha.id });
      await updateEmailSettings(sql, a.id, {
        senderName: 'Acme People',
        replyTo: 'HR@Acme.test',
        overrides: { invite: { subject: 'Sign {{document_title}}', intro: ' ' }, reminder: {} },
      });
      expect(await getBrand(sql, a.id)).toMatchObject({
        senderName: 'Acme People',
        replyTo: 'hr@acme.test',
        emailOverrides: { invite: { subject: 'Sign {{document_title}}' } },
      });
      await updateEmailSettings(sql, a.id, { senderName: '', replyTo: '', overrides: {} });
      expect(await getBrand(sql, a.id)).toMatchObject({
        senderName: null,
        replyTo: null,
        emailOverrides: {},
      });
      expect(await getSigningBrand(sql, a.id)).toMatchObject({ name: 'Mail A', showBadge: true });
      expect(await getSigningBrand(sql, 'ws_missing')).toBeNull();
    });

    it('keeps one workspace per signing domain and forgets verification on change', async () => {
      const a = await createWorkspace(sql, { name: 'Domain A', userId: users.asha.id });
      const b = await createWorkspace(sql, { name: 'Domain B', userId: users.asha.id });
      const settings = { showBadge: false, certificateFooter: '  Acme   Pvt Ltd ' };
      await updateSigningSettings(
        sql,
        a.id,
        { ...settings, signingDomain: 'https://Sign.Acme.test/' },
        'app.example.com',
      );
      expect(await getBrand(sql, a.id)).toMatchObject({
        showBadge: false,
        certificateFooter: 'Acme Pvt Ltd',
        signingDomain: 'sign.acme.test',
        signingDomainVerified: false,
      });
      const taken = await rejectsWith(
        updateSigningSettings(
          sql,
          b.id,
          { ...settings, signingDomain: 'sign.acme.test' },
          'app.example.com',
        ),
        'CONFLICT',
      );
      expect(taken.field).toBe('signingDomain');

      await sql`update app_brand_settings set signing_domain_verified_at = now()
        where workspace_id = ${a.id}`;
      await updateSigningSettings(
        sql,
        a.id,
        { ...settings, signingDomain: 'sign.acme.test' },
        'app.example.com',
      );
      expect((await getBrand(sql, a.id)).signingDomainVerified).toBe(true);
      await updateSigningSettings(
        sql,
        a.id,
        { ...settings, signingDomain: 'docs.acme.test' },
        'app.example.com',
      );
      expect((await getBrand(sql, a.id)).signingDomainVerified).toBe(false);
      await updateSigningSettings(
        sql,
        a.id,
        { showBadge: true, certificateFooter: '', signingDomain: '' },
        'app.example.com',
      );
      expect(await getBrand(sql, a.id)).toMatchObject({
        showBadge: true,
        certificateFooter: null,
        signingDomain: null,
      });
    });

    it('keeps personal preferences per person', async () => {
      expect(await getPreferences(sql, users.zoe.id)).toEqual({
        theme: 'system',
        timezone: null,
        locale: 'en',
      });
      await updatePreferences(sql, users.zoe.id, { theme: 'dark' });
      expect(await updatePreferences(sql, users.zoe.id, { timezone: 'Asia/Kolkata' })).toEqual({
        theme: 'dark',
        timezone: 'Asia/Kolkata',
        locale: 'en',
      });
      await rejectsWith(
        updatePreferences(sql, users.zoe.id, { timezone: 'Mars/Base' }),
        'VALIDATION',
      );
      await rejectsWith(updatePreferences(sql, users.zoe.id, { theme: 'neon' }), 'VALIDATION');
      expect((await getPreferences(sql, users.mia.id)).theme).toBe('system');
      expect((await updatePreferences(sql, users.zoe.id, { timezone: '' })).timezone).toBeNull();
    });

    it('keeps a time zone per workspace, unset until one is chosen', async () => {
      const a = await createWorkspace(sql, { name: 'Zone A', userId: users.asha.id });
      const b = await createWorkspace(sql, { name: 'Zone B', userId: users.asha.id });
      expect(await workspaceTimeZone(sql, a.id)).toBeNull();
      expect(await setWorkspaceTimeZone(sql, a.id, 'Pacific/Auckland')).toBe('Pacific/Auckland');
      expect(await workspaceTimeZone(sql, a.id)).toBe('Pacific/Auckland');
      expect(await workspaceTimeZone(sql, b.id)).toBeNull();
      await rejectsWith(setWorkspaceTimeZone(sql, a.id, 'Mars/Phobos'), 'VALIDATION');
      await rejectsWith(setWorkspaceTimeZone(sql, a.id, ''), 'VALIDATION');
      expect(await workspaceTimeZone(sql, a.id)).toBe('Pacific/Auckland');
      expect(await workspaceTimeZone(sql, 'ws_missing')).toBeNull();
    });
  });

  describe('the mounted sign server', () => {
    const pdf: PdfEngine = {
      inspectPdf: async () => ({ pageCount: 1, pages: [{ width: 612, height: 792 }] }),
      renderFields: async (bytes) => bytes,
      appendCertificate: async (bytes) => bytes,
      seal: async (bytes) => bytes,
    };
    const document = Buffer.from('%PDF-1.7\n').toString('base64');
    const body = {
      title: 'Offer letter',
      documents: [{ key: 'offer', name: 'offer.pdf', content: document }],
      recipients: [{ key: 'asha', name: 'Asha', email: 'asha@example.com' }],
      fields: [
        { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
      ],
    };

    it('keeps each workspace to its own envelopes, files and events', async () => {
      const a = await createWorkspace(sql, { name: 'Tenant A', userId: users.asha.id });
      const b = await createWorkspace(sql, { name: 'Tenant B', userId: users.ravi.id });
      const keyA = (
        await createApiKey(sql, { workspaceId: a.id, name: 'A', createdBy: users.asha.id })
      ).key;
      const keyB = (
        await createApiKey(sql, { workspaceId: b.id, name: 'B', createdBy: users.ravi.id })
      ).key;
      const mailer = consoleMailer({ silent: true });
      const sign = createSignServer({
        store: postgresStore(sql),
        files: memoryFileStore(),
        mailer,
        otp: consoleOtpSender({ silent: true }),
        pdf,
        sealer: { p12: new Uint8Array([1]), passphrase: '' },
        apiKeys: [],
        authenticate: createAuthenticate({
          appUrl: APP_URL,
          resolveApiKey: (key) => resolveApiKey(sql, key),
          sessionUser: async () => null,
          roleOf: async () => null,
        }),
        basePath: '/api',
        publicUrl: APP_URL,
      });
      const call = (key: string, method: string, path: string, json?: unknown) =>
        sign.app.request(`/api${path}`, {
          method,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
        });

      const created = await call(keyA, 'POST', '/v1/envelopes', body);
      expect(created.status).toBe(201);
      const envelope = (await created.json()) as { id: string; documents: { id: string }[] };
      const [row] = await sql`select workspace_id from sign_envelopes where id = ${envelope.id}`;
      expect(row?.workspace_id).toBe(a.id);

      const paths = [
        ['GET', `/v1/envelopes/${envelope.id}`],
        ['GET', `/v1/envelopes/${envelope.id}/events`],
        ['GET', `/v1/envelopes/${envelope.id}/certificate`],
        ['GET', `/v1/envelopes/${envelope.id}/documents/${envelope.documents[0]!.id}`],
        ['PATCH', `/v1/envelopes/${envelope.id}`],
        ['POST', `/v1/envelopes/${envelope.id}/send`],
        ['POST', `/v1/envelopes/${envelope.id}/void`],
      ] as const;
      for (const [method, path] of paths) {
        const res = await call(
          keyB,
          method,
          path,
          method === 'GET' ? undefined : { title: 'x', reason: 'x' },
        );
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      const listB = (await (await call(keyB, 'GET', '/v1/envelopes')).json()) as {
        envelopes: unknown[];
      };
      expect(listB.envelopes).toEqual([]);
      const listA = (await (await call(keyA, 'GET', '/v1/envelopes')).json()) as {
        envelopes: { id: string }[];
      };
      expect(listA.envelopes.map((e) => e.id)).toEqual([envelope.id]);
      expect((await call(keyA, 'POST', `/v1/envelopes/${envelope.id}/send`, {})).status).toBe(200);
      expect(mailer.sent.at(-1)?.text).toContain(`${APP_URL}/api/sign/`);
      expect((await call('cvs_wrong', 'GET', '/v1/envelopes')).status).toBe(401);
    });

    it('dates each workspace’s documents and emails in its own zone', async () => {
      const india = await createWorkspace(sql, { name: 'India', userId: users.asha.id });
      const nz = await createWorkspace(sql, { name: 'New Zealand', userId: users.asha.id });
      const plain = await createWorkspace(sql, { name: 'Default', userId: users.asha.id });
      await setWorkspaceTimeZone(sql, india.id, 'Asia/Kolkata');
      await setWorkspaceTimeZone(sql, nz.id, 'Pacific/Auckland');
      const drawn: Record<string, (string | undefined)[]> = {};
      const mailer = consoleMailer({ silent: true });
      const sign = createSignServer({
        store: postgresStore(sql),
        files: memoryFileStore(),
        mailer,
        otp: consoleOtpSender({ silent: true }),
        pdf: {
          ...pdf,
          renderFields: async (bytes, _fields, _values, recipients, options) => {
            drawn[recipients[0]!.name] = [options.timeZone];
            return bytes;
          },
          appendCertificate: async (bytes, input) => {
            drawn[input.envelope.recipients[0]!.name]!.push(input.timeZone);
            return bytes;
          },
        },
        sealer: { p12: new Uint8Array([1]), passphrase: '' },
        apiKeys: [],
        authenticate: createAuthenticate({
          appUrl: APP_URL,
          resolveApiKey: (key) => resolveApiKey(sql, key),
          sessionUser: async () => null,
          roleOf: async () => null,
        }),
        timeZone: 'America/New_York',
        workspaceTimeZone: (workspaceId) => workspaceTimeZone(sql, workspaceId),
        basePath: '/api',
        publicUrl: APP_URL,
      });
      const expiresAt = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 2, 31, 18, 29));
      const run = async (workspaceId: string, name: string) => {
        const { key } = await createApiKey(sql, {
          workspaceId,
          name: 'zone',
          createdBy: users.asha.id,
        });
        const created = await sign.app.request('/api/v1/envelopes', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            ...body,
            recipients: [{ key: 'asha', name, email: `${name.toLowerCase()}@example.com` }],
            expiresAt: expiresAt.toISOString(),
            send: true,
          }),
        });
        expect(created.status).toBe(201);
        const envelope = (await created.json()) as { fields: { id: string }[] };
        const mail = mailer.sent.at(-1)!;
        const token = /\/api\/sign\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
        const view = (await (await sign.app.request(`/api/v1/sign/${token}`)).json()) as {
          timeZone: string;
        };
        const signed = await sign.app.request(`/api/v1/sign/${token}/submit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            consent: true,
            values: [{ fieldId: envelope.fields[0]!.id, value: PNG }],
          }),
        });
        expect(signed.status).toBe(200);
        return { expiry: /expires on ([^.]+ \S+)\./.exec(mail.text)?.[1], zone: view.timeZone };
      };

      const year = expiresAt.getUTCFullYear();
      expect(await run(india.id, 'Indira')).toEqual({
        expiry: `31 Mar ${year}, 23:59 GMT+5:30`,
        zone: 'Asia/Kolkata',
      });
      expect(await run(nz.id, 'Niko')).toEqual({
        expiry: `1 Apr ${year}, 07:29 GMT+13`,
        zone: 'Pacific/Auckland',
      });
      expect(await run(plain.id, 'Dana')).toEqual({
        expiry: `31 Mar ${year}, 14:29 GMT-4`,
        zone: 'America/New_York',
      });
      expect(drawn).toEqual({
        Indira: ['Asia/Kolkata', 'Asia/Kolkata'],
        Niko: ['Pacific/Auckland', 'Pacific/Auckland'],
        Dana: ['America/New_York', 'America/New_York'],
      });
    });

    it('counts, finds whose turn it is, lists activity and remembers senders', async () => {
      const ws = await createWorkspace(sql, { name: 'Dashboard', userId: users.asha.id });
      const other = await createWorkspace(sql, { name: 'Elsewhere', userId: users.ravi.id });
      const key = (
        await createApiKey(sql, { workspaceId: ws.id, name: 'D', createdBy: users.asha.id })
      ).key;
      const sign = createSignServer({
        store: postgresStore(sql),
        files: memoryFileStore(),
        mailer: consoleMailer({ silent: true }),
        otp: consoleOtpSender({ silent: true }),
        pdf,
        sealer: { p12: new Uint8Array([1]), passphrase: '' },
        apiKeys: [],
        authenticate: createAuthenticate({
          appUrl: APP_URL,
          resolveApiKey: (k) => resolveApiKey(sql, k),
          sessionUser: async () => null,
          roleOf: async () => null,
        }),
        basePath: '/api',
        publicUrl: APP_URL,
      });
      const call = async (method: string, path: string, json?: unknown) =>
        (await (
          await sign.app.request(`/api${path}`, {
            method,
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
          })
        ).json()) as { id: string; documents: { id: string }[] };
      const forAsha = {
        ...body,
        recipients: [{ key: 'asha', name: 'Asha', email: users.asha.email.toUpperCase() }],
      };
      const draft = await call('POST', '/v1/envelopes', body);
      const mine = await call('POST', '/v1/envelopes', { ...forAsha, title: 'Yours', send: true });
      const voided = await call('POST', '/v1/envelopes', { ...body, send: true });
      await call('POST', `/v1/envelopes/${voided.id}/void`, { reason: 'Wrong file' });

      expect(await envelopeCounts(sql, ws.id)).toEqual({
        draft: 1,
        waiting: 1,
        completed: 0,
        declined: 0,
        expired: 0,
        voided: 1,
      });
      expect(await envelopeCounts(sql, other.id)).toMatchObject({ draft: 0, waiting: 0 });

      const waiting = await waitingOn(sql, ws.id, users.asha.email);
      expect(waiting.map((w) => [w.envelopeId, w.title])).toEqual([[mine.id, 'Yours']]);
      expect(await waitingOn(sql, other.id, users.asha.email)).toEqual([]);
      expect(await waitingOn(sql, ws.id, users.ravi.email)).toEqual([]);

      const activity = await recentActivity(sql, ws.id, 20);
      expect(activity[0]).toMatchObject({ envelopeId: voided.id, action: 'envelope.voided' });
      expect(activity.map((a) => a.action)).toContain('recipient.notified');
      expect(activity.find((a) => a.action === 'recipient.notified')?.who).toBeTruthy();
      expect(activity.every((a) => a.action !== 'envelope.updated')).toBe(true);
      expect(await recentActivity(sql, other.id)).toEqual([]);

      await recordSender(sql, { workspaceId: ws.id, envelopeId: draft.id, userId: users.asha.id });
      await recordSender(sql, { workspaceId: ws.id, envelopeId: draft.id, userId: users.ravi.id });
      expect(await senderOf(sql, ws.id, draft.id)).toEqual({ userId: users.asha.id, name: 'Asha' });
      expect(await senderOf(sql, other.id, draft.id)).toBeNull();
      expect(await senderOf(sql, ws.id, mine.id)).toBeNull();
      expect(await sentBy(sql, ws.id, users.asha.id, [draft.id, mine.id])).toEqual(
        new Set([draft.id]),
      );
      expect(await sentBy(sql, ws.id, users.asha.id, [])).toEqual(new Set());

      const sha = 'c'.repeat(64);
      const sealed = {
        action: 'document.sealed',
        data: { documentId: mine.documents[0]!.id, sha256: sha },
      };
      await sql`insert into sign_audit_events (envelope_id, seq, data)
        values (${mine.id}, 99, ${sql.json(sealed)})`;
      expect(await findSealedDocument(sql, ws.id, sha)).toEqual({
        envelopeId: mine.id,
        title: 'Yours',
        documentName: 'offer.pdf',
      });
      expect(await findSealedDocument(sql, other.id, sha)).toBeNull();
      expect(await findSealedDocument(sql, ws.id, 'd'.repeat(64))).toBeNull();
    });
  });
});
