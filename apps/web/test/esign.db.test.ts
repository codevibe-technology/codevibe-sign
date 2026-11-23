import { randomUUID } from 'node:crypto';
import { computeLeegalityMac } from '@codevibe_technology/sign-aadhaar';
import { SignError, type Envelope } from '@codevibe_technology/sign-core';
import { seal, verifySignatures } from '@codevibe_technology/sign-pdf';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  postgresStore,
  sealedFileKey,
  type SignServer,
} from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import { listAudit } from '@/server/billing/audit';
import { billingConfig } from '@/server/billing/config';
import { creditBalance, creditHistory, grantCredits } from '@/server/billing/credits';
import { createEsignOptions, esignState } from '@/server/esign/runtime';
import {
  getEsignSettings,
  ownCredentials,
  saveOwnCredentials,
  setEsignMode,
} from '@/server/esign/settings';
import { esignOverview, esignSendInfo } from '@/server/esign/overview';
import { listEsignUsage } from '@/server/esign/usage';
import { migrateAll } from '@/server/migrate';
import { createWorkspace } from '@/server/workspaces';
import { makeP12, makePdf, PNG } from './fixtures';

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; image: null } | null,
  sql: null as unknown,
}));

vi.mock('@/server/auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/db', () => ({ db: () => state.sql }));
vi.mock('@/server/client-address', () => ({ clientAddress: () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const url = process.env.DATABASE_URL;
const APP_URL = 'https://sign.example.test';
const SALT = 'platform-private-salt';
const OWN_SALT = 'workspace-private-salt';
const AUTH_SECRET = 'a'.repeat(40);

const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_TESTKEY123',
  RAZORPAY_KEY_SECRET: 'key-secret-for-tests',
  INVOICE_SELLER_NAME: 'Codevibe Technology Private Limited',
  INVOICE_SELLER_GSTIN: '06AANCC6406C1ZX',
  INVOICE_SELLER_ADDRESS: 'SAS Tower, Gurugram, Haryana 122001',
  LEEGALITY_API_KEY: 'platform-token',
  LEEGALITY_PRIVATE_SALT: SALT,
  LEEGALITY_WORKFLOW_ID: 'workflow',
  ESIGN_PROVIDER_COST_INR: '25',
  ESIGN_MARKUP_INR: '10',
};

interface ProviderDocument {
  id: string;
  signUrl: string;
  uploaded: Uint8Array;
  state: 'open' | 'signed' | 'rejected' | 'expired';
  token: string;
}

/** A stand-in for Leegality's API: keeps requests in memory and signs with its own key. */
function fakeLeegality(espP12: Uint8Array) {
  const documents = new Map<string, ProviderDocument>();
  const calls = { create: 0, status: 0, fetch: 0 };
  let refuse: string | null = null;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const target = new URL(input);
    const token = new Headers(init?.headers).get('x-auth-token') ?? '';
    if (refuse !== null && token === refuse) return new Response('no', { status: 401 });
    if (target.pathname.endsWith('/v3.0/sign/request') && init?.method === 'POST') {
      calls.create += 1;
      const body = JSON.parse(String(init.body)) as {
        file: { file: string };
        invitees: { name: string; email?: string }[];
      };
      const id = `doc_${randomUUID().slice(0, 8)}`;
      const signUrl = `https://sandbox.leegality.com/sign/${id}`;
      documents.set(id, {
        id,
        signUrl,
        uploaded: new Uint8Array(Buffer.from(body.file.file, 'base64')),
        state: 'open',
        token,
      });
      return json({
        status: 1,
        data: { documentId: id, invitees: [{ ...body.invitees[0], signUrl }] },
      });
    }
    const id = target.searchParams.get('documentId') ?? '';
    const document = documents.get(id);
    if (target.pathname.endsWith('/v3.2/sign/request')) {
      calls.status += 1;
      if (!document || document.token !== token) {
        return json({ status: 0, messages: [{ code: 'no.document.found', message: 'No doc' }] });
      }
      return json({
        status: 1,
        data: {
          documentId: id,
          ...(document.state === 'signed' ? { auditTrail: 'trail' } : {}),
          requests: [
            {
              signUrl: document.signUrl,
              signed: document.state === 'signed',
              rejected: document.state === 'rejected',
              expired: document.state === 'expired',
            },
          ],
        },
      });
    }
    if (target.pathname.endsWith('/v3.1/document/fetchDocument') && document) {
      calls.fetch += 1;
      const signed = await seal(document.uploaded, {
        p12: espP12,
        passphrase: 'esp',
        certify: false,
        reason: 'Aadhaar eSign',
      });
      return new Response(signed, { headers: { 'content-type': 'application/pdf' } });
    }
    return new Response('not found', { status: 404 });
  };

  return {
    fetch,
    documents,
    calls,
    refuseToken(token: string | null) {
      refuse = token;
    },
    last() {
      const document = [...documents.values()].at(-1);
      if (!document) throw new Error('the provider was never asked');
      return document;
    },
    webhook(document: ProviderDocument, action: 'Signed' | 'Rejected', salt = SALT) {
      document.state = action === 'Signed' ? 'signed' : 'rejected';
      return JSON.stringify({
        documentId: document.id,
        mac: computeLeegalityMac(document.id, salt),
        webhookType: 'Success',
        request: { action, name: 'RAVI KUMAR', invitationUrl: document.signUrl },
      });
    },
  };
}

describe.skipIf(!url)('aadhaar esign against PostgreSQL', () => {
  const schema = `web_esign_test_${process.pid}_${Date.now()}`;
  const sealP12 = makeP12('pass');
  const espP12 = makeP12('esp');
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let sign: SignServer;
  let provider: ReturnType<typeof fakeLeegality>;
  let files: ReturnType<typeof memoryFileStore>;
  const mailer = consoleMailer({ silent: true });
  const keys = new Map<string, string>();

  async function person(name = 'Asha') {
    const id = randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id, email, name, image: null };
  }

  async function workspace(plan: 'free' | 'cloud' = 'free', credits = 0) {
    const owner = await person();
    const ws = await createWorkspace(
      sql,
      { name: 'Acme', userId: owner.id, plan },
      { mode: 'hosted', freeOverrides: {} },
    );
    if (credits) {
      await grantCredits(sql, { workspaceId: ws.id, credits, ref: `grant_${randomUUID()}` });
    }
    const key = `key-${randomUUID()}`;
    keys.set(ws.id, key);
    return { ...ws, owner, key };
  }

  async function member(workspaceId: string, role: Role) {
    const user = await person(role);
    await sql`
      insert into app_members (workspace_id, user_id, role)
      values (${workspaceId}, ${user.id}, ${role})`;
    return user;
  }

  const api = (key: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${key}`);
    if (typeof init.body === 'string') headers.set('content-type', 'application/json');
    return sign.app.fetch(new Request(`${APP_URL}/api${path}`, { ...init, headers }));
  };

  const signer = (token: string, path = '', init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') headers.set('content-type', 'application/json');
    return sign.app.fetch(
      new Request(`${APP_URL}/api/v1/sign/${token}${path}`, { ...init, headers }),
    );
  };

  /** Sends an envelope whose one signer, or last signer, signs with Aadhaar eSign. */
  async function send(ws: { key: string }, options: { withFirstSigner?: boolean } = {}) {
    const first = options.withFirstSigner
      ? [
          {
            key: 'r0',
            name: 'Meera',
            email: `meera-${randomUUID().slice(0, 6)}@example.com`,
            role: 'signer',
            auth: 'email_link',
            order: 1,
          },
        ]
      : [];
    const email = `ravi-${randomUUID().slice(0, 6)}@example.com`;
    const form = new FormData();
    form.set(
      'envelope',
      JSON.stringify({
        title: 'Appointment letter',
        routing: 'sequential',
        send: true,
        recipients: [
          ...first,
          { key: 'r1', name: 'Ravi Kumar', email, role: 'signer', auth: 'aadhaar', order: 2 },
        ],
        documents: [{ key: 'd1', name: 'letter.pdf' }],
        fields: [
          ...first.map(() => ({
            recipient: 'r0',
            type: 'signature',
            page: 0,
            rect: { x: 72, y: 500, width: 180, height: 48 },
          })),
          {
            recipient: 'r1',
            type: 'signature',
            page: 0,
            rect: { x: 72, y: 600, width: 180, height: 48 },
          },
        ],
      }),
    );
    form.append(
      'documents',
      new Blob([await makePdf(1)], { type: 'application/pdf' }),
      'letter.pdf',
    );
    const res = await api(ws.key, '/v1/envelopes', { method: 'POST', body: form });
    return { res, email, firstEmail: first[0]?.email };
  }

  function tokenFor(email: string) {
    const mail = [...mailer.sent].reverse().find((m) => m.to === email && /\/sign\//.test(m.text));
    const token = mail?.text.match(/\/sign\/([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error(`no signing link for ${email}`);
    return token;
  }

  async function start(token: string) {
    const view = (await (await signer(token)).json()) as { fields: { id: string }[] };
    return signer(token, '/esign', {
      method: 'POST',
      body: JSON.stringify({
        consent: true,
        values: view.fields.map((f) => ({ fieldId: f.id, value: PNG })),
      }),
    });
  }

  const hook = (body: string) =>
    sign.app.fetch(
      new Request(`${APP_URL}/api/v1/esign/webhooks/leegality`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );

  const envelopeOf = async (ws: { key: string }, id: string) =>
    (await (await api(ws.key, `/v1/envelopes/${id}`)).json()) as Envelope;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 12, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0016_esign_settings');
    state.sql = sql;
  });

  beforeEach(() => {
    vi.stubEnv('PLAN_MODE', 'hosted');
    vi.stubEnv('AUTH_SECRET', AUTH_SECRET);
    vi.stubEnv('APP_URL', APP_URL);
    provider = fakeLeegality(espP12);
    files = memoryFileStore();
    mailer.sent.length = 0;
    sign = createSignServer({
      store: postgresStore(sql),
      files,
      mailer,
      otp: consoleOtpSender({ silent: true }),
      sealer: { p12: sealP12, passphrase: 'pass' },
      apiKeys: [],
      authenticate: async (request) => {
        const key = request.headers.get('authorization')?.replace(/^Bearer /, '');
        const workspaceId = [...keys].find(([, value]) => value === key)?.[0];
        return workspaceId ? { id: `key:${workspaceId}`, workspaceId } : null;
      },
      basePath: '/api',
      publicUrl: APP_URL,
      signingPageUrl: `${APP_URL}/sign`,
      esign: createEsignOptions({ sql, config: () => billingConfig(ENV), fetch: provider.fetch }),
    });
    state.user = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  describe('the whole run on prepaid credits', () => {
    it('holds a credit at the start, spends it on the signature and seals over the eSign', async () => {
      const ws = await workspace('free', 2);
      const { res, email, firstEmail } = await send(ws, { withFirstSigner: true });
      expect(res.status).toBe(201);
      const envelope = (await res.json()) as Envelope;

      const meera = tokenFor(firstEmail!);
      const meeraView = (await (await signer(meera)).json()) as { fields: { id: string }[] };
      const submitted = await signer(meera, '/submit', {
        method: 'POST',
        body: JSON.stringify({
          consent: true,
          values: meeraView.fields.map((f) => ({ fieldId: f.id, value: PNG })),
        }),
      });
      expect(submitted.status).toBe(200);

      const token = tokenFor(email);
      const view = (await (await signer(token)).json()) as {
        esign: { available: boolean; status: string | null };
      };
      expect(view.esign).toMatchObject({ available: true, status: null });
      const plain = await signer(token, '/submit', {
        method: 'POST',
        body: JSON.stringify({ consent: true, values: [] }),
      });
      expect(plain.status).toBe(400);

      const started = await start(token);
      expect(started.status).toBe(200);
      const { signUrl } = (await started.json()) as { signUrl: string };
      const document = provider.last();
      expect(signUrl).toBe(document.signUrl);
      expect(document.token).toBe('platform-token');
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 1, reserved: 1 });

      const again = await start(token);
      expect(((await again.json()) as { signUrl: string }).signUrl).toBe(signUrl);
      expect(provider.calls.create).toBe(1);
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 1, reserved: 1 });

      const body = provider.webhook(document, 'Signed');
      expect((await hook(body)).status).toBe(200);
      expect((await hook(body)).status).toBe(200);
      await sign.tick();

      const done = await envelopeOf(ws, envelope.id);
      expect(done.status).toBe('completed');
      const ravi = done.recipients.find((r) => r.auth === 'aadhaar')!;
      expect(ravi).toMatchObject({
        status: 'signed',
        esign: { provider: 'leegality', status: 'signed' },
      });
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 1, reserved: 0 });
      const kinds = (await creditHistory(sql, ws.id)).map((entry) => entry.kind);
      expect(kinds.filter((kind) => kind === 'consume')).toHaveLength(1);

      const sealed = await files.get(sealedFileKey(envelope.id, done.documents[0]!.id));
      expect(sealed).not.toBeNull();
      const signatures = await verifySignatures(sealed!);
      expect(signatures).toHaveLength(2);
      expect(signatures.every((signature) => signature.valid)).toBe(true);
      expect(signatures[1]!.coversWholeDocument).toBe(true);

      const check = (await (
        await api(
          ws.key,
          `/v1/envelopes/${envelope.id}/documents/${done.documents[0]!.id}/verification`,
        )
      ).json()) as { valid: boolean };
      expect(check.valid).toBe(true);
      const certificate = await api(
        ws.key,
        `/v1/envelopes/${envelope.id}/documents/${done.documents[0]!.id}?version=certificate`,
      );
      expect(certificate.status).toBe(200);

      const actions = (await listAudit(sql, ws.id, { prefix: 'esign.' })).map((row) => row.action);
      expect(actions.sort()).toEqual(['esign.completed', 'esign.started']);
      const [usage] = await listEsignUsage(sql, ws.id);
      expect(usage).toMatchObject({
        mode: 'platform',
        billed: true,
        outcome: 'signed',
        envelopeTitle: 'Appointment letter',
      });
      const stored = JSON.stringify(await sql`select * from app_audit_log`);
      expect(stored).not.toMatch(/platform-token|platform-private-salt/);
    });

    it('gives the credit back when the signer declines at the provider', async () => {
      const ws = await workspace('free', 1);
      const { res, email } = await send(ws);
      const envelope = (await res.json()) as Envelope;
      expect((await start(tokenFor(email))).status).toBe(200);
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 0, reserved: 1 });

      expect((await hook(provider.webhook(provider.last(), 'Rejected'))).status).toBe(200);
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 1, reserved: 0 });
      expect((await envelopeOf(ws, envelope.id)).status).toBe('declined');
      const [usage] = await listEsignUsage(sql, ws.id);
      expect(usage).toMatchObject({ outcome: 'declined' });
      const actions = (await listAudit(sql, ws.id, { prefix: 'esign.' })).map((row) => row.action);
      expect(actions).toContain('esign.failed');
    });

    it('refuses a callback with the wrong mac and changes nothing', async () => {
      const ws = await workspace('free', 1);
      const { res, email } = await send(ws);
      const envelope = (await res.json()) as Envelope;
      await start(tokenFor(email));
      const forged = provider.webhook(provider.last(), 'Signed', 'someone-elses-salt');
      provider.last().state = 'open';
      expect((await hook(forged)).status).toBe(401);
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 0, reserved: 1 });
      expect((await envelopeOf(ws, envelope.id)).status).not.toBe('completed');
    });

    it('does not call the provider when there is no credit, and tells the sender why', async () => {
      const ws = await workspace('free', 0);
      const refused = await send(ws);
      expect(refused.res.status).toBe(409);
      const body = (await refused.res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('ESIGN_UNAVAILABLE');
      expect(body.error.message).toMatch(/no Aadhaar eSign credits left/);
      expect(body.error.message).not.toMatch(/cost|markup|Leegality/i);
      expect(provider.calls.create).toBe(0);
    });

    it('lets one of two signers start when one credit is left', async () => {
      const ws = await workspace('free', 2);
      const one = await send(ws);
      const two = await send(ws);
      expect(one.res.status).toBe(201);
      expect(two.res.status).toBe(201);
      // One credit is spent elsewhere before either signer opens their link.
      const options = createEsignOptions({ sql, config: () => billingConfig(ENV) });
      await options.onStart?.({
        workspaceId: ws.id,
        envelopeId: 'env_other',
        recipientId: 'rec_other',
        ref: 'other',
      });
      const results = await Promise.all([start(tokenFor(one.email)), start(tokenFor(two.email))]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const lost = results.find((r) => r.status === 409)!;
      const message = ((await lost.json()) as { error: { message: string } }).error.message;
      expect(message).toMatch(/not available for this document right now/);
      expect(message).not.toMatch(/credit|cost|markup/i);
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 0, reserved: 2 });
      expect(provider.calls.create).toBe(1);
    });
  });

  describe('the credit hooks', () => {
    const hookInput = (workspaceId: string, ref = `ref_${randomUUID()}`) => ({
      workspaceId,
      envelopeId: 'env_1',
      recipientId: 'rec_1',
      ref,
    });

    it('releases on expiry and failure, once', async () => {
      const ws = await workspace('free', 3);
      const options = createEsignOptions({ sql, config: () => billingConfig(ENV) });
      for (const outcome of ['expired', 'failed'] as const) {
        const input = hookInput(ws.id);
        await options.onStart!(input);
        await options.onEnd!({ ...input, outcome });
        await options.onEnd!({ ...input, outcome });
      }
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 3, reserved: 0 });
    });

    it('charges a signature that arrives after the hold was given back, once', async () => {
      const ws = await workspace('free', 1);
      const options = createEsignOptions({ sql, config: () => billingConfig(ENV) });
      const input = hookInput(ws.id);
      await options.onStart!(input);
      await options.onEnd!({ ...input, outcome: 'expired' });
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 1, reserved: 0 });
      await options.onEnd!({ ...input, outcome: 'signed' });
      await options.onEnd!({ ...input, outcome: 'signed' });
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 0, reserved: 0 });
      const [usage] = await listEsignUsage(sql, ws.id);
      expect(usage).toMatchObject({ outcome: 'signed' });
    });

    it('never goes below zero: a late signature with no credit left is noted as unbilled', async () => {
      const ws = await workspace('free', 1);
      const options = createEsignOptions({ sql, config: () => billingConfig(ENV) });
      const late = hookInput(ws.id);
      await options.onStart!(late);
      await options.onEnd!({ ...late, outcome: 'expired' });
      const other = hookInput(ws.id);
      await options.onStart!(other);
      await options.onEnd!({ ...other, outcome: 'signed' });
      await options.onEnd!({ ...late, outcome: 'signed' });
      await options.onEnd!({ ...late, outcome: 'signed' });
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 0, reserved: 0 });
      const unbilled = (await listAudit(sql, ws.id, { prefix: 'esign.unbilled' })).length;
      expect(unbilled).toBe(1);
    });

    it('refuses the start with words for the signer when no credit is left', async () => {
      const ws = await workspace('free', 0);
      const options = createEsignOptions({ sql, config: () => billingConfig(ENV) });
      const error = await options.onStart!(hookInput(ws.id)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(SignError);
      expect((error as SignError).code).toBe('ESIGN_UNAVAILABLE');
      expect((error as SignError).details).toMatchObject({ reason: 'no_credits' });
    });
  });

  describe('availability', () => {
    it('says coming soon while the install has no provider account or no price', async () => {
      const ws = await workspace('free', 5);
      const bare = await esignState({ sql, config: () => billingConfig({}) }, ws.id);
      expect(bare.blocked).toMatchObject({ reason: 'not_configured' });
      expect(bare.blocked!.message).toMatch(/coming soon/);
      const { ESIGN_PROVIDER_COST_INR: _cost, ...noPrice } = ENV;
      const unpriced = await esignState({ sql, config: () => billingConfig(noPrice) }, ws.id);
      expect(unpriced.blocked).toMatchObject({ reason: 'price_not_set' });
      expect(unpriced.blocked!.message).not.toMatch(/cost|markup/i);
    });

    it('needs no credits on a self-hosted install with its own provider account', async () => {
      const ws = await workspace('free', 0);
      vi.stubEnv('PLAN_MODE', 'self-hosted');
      const ready = await esignState({ sql, config: () => billingConfig(ENV) }, ws.id);
      expect(ready).toEqual({ mode: 'platform', creditsRequired: false, blocked: null });
      const options = createEsignOptions({ sql, config: () => billingConfig(ENV) });
      const input = { workspaceId: ws.id, envelopeId: 'e', recipientId: 'r', ref: 'self-1' };
      await options.onStart!(input);
      await options.onEnd!({ ...input, outcome: 'signed' });
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 0, reserved: 0 });
      expect((await listEsignUsage(sql, ws.id))[0]).toMatchObject({ billed: false });
    });

    it('shows the sender the final price only', async () => {
      const free = await workspace('free', 3);
      const cloud = await workspace('cloud', 3);
      for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
      expect(await esignSendInfo(sql, free.id)).toMatchObject({
        available: true,
        creditsRequired: true,
        credits: 3,
        pricePaise: 3500,
      });
      expect((await esignSendInfo(sql, cloud.id)).pricePaise).toBe(2500);
      const overview = await esignOverview(sql, { workspaceId: free.id, appUrl: APP_URL });
      expect(overview).toMatchObject({
        pricePaise: 3500,
        ownAllowed: false,
        testMode: true,
        webhookUrl: `${APP_URL}/api/v1/esign/webhooks/leegality`,
        redirectUrl: `${APP_URL}/sign?esign=return`,
      });
      expect(JSON.stringify(overview)).not.toMatch(/cost|markup|platform-token|private-salt/i);
    });
  });

  describe('a workspace with its own Leegality account', () => {
    const credentials = {
      apiKey: 'own-auth-token-1234',
      privateSalt: OWN_SALT,
      workflowId: 'wf_own',
      environment: 'sandbox' as const,
    };

    it('stores the details encrypted and never hands them back', async () => {
      const ws = await workspace('cloud');
      const saved = await saveOwnCredentials(sql, {
        workspaceId: ws.id,
        userId: ws.owner.id,
        credentials,
      });
      expect(saved.own).toMatchObject({
        configured: true,
        keyHint: '1234',
        environment: 'sandbox',
      });
      expect(JSON.stringify(saved)).not.toMatch(/own-auth-token|workspace-private-salt/);
      const [row] = await sql`select * from app_esign_settings where workspace_id = ${ws.id}`;
      expect(JSON.stringify(row)).not.toMatch(/own-auth-token|workspace-private-salt/);
      expect(await ownCredentials(sql, ws.id)).toEqual(credentials);

      // A sealed value copied to another workspace's row does not open there.
      const other = await workspace('cloud');
      await saveOwnCredentials(sql, { workspaceId: other.id, userId: other.owner.id, credentials });
      await sql`
        update app_esign_settings set own_api_key = ${row!.own_api_key as string}
        where workspace_id = ${other.id}`;
      expect(await ownCredentials(sql, other.id)).toBeNull();
    });

    it('signs through that account, uses no credit and checks callbacks with its salt', async () => {
      const ws = await workspace('cloud', 0);
      await saveOwnCredentials(sql, { workspaceId: ws.id, userId: ws.owner.id, credentials });
      await setEsignMode(sql, { workspaceId: ws.id, userId: ws.owner.id, mode: 'own' });
      const { res, email } = await send(ws);
      expect(res.status).toBe(201);
      const envelope = (await res.json()) as Envelope;
      expect((await start(tokenFor(email))).status).toBe(200);
      const document = provider.last();
      expect(document.token).toBe('own-auth-token-1234');

      const withPlatformSalt = provider.webhook(document, 'Signed', SALT);
      document.state = 'open';
      expect((await hook(withPlatformSalt)).status).toBe(401);
      expect((await hook(provider.webhook(document, 'Signed', OWN_SALT))).status).toBe(200);
      await sign.tick();
      expect((await envelopeOf(ws, envelope.id)).status).toBe('completed');
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 0, reserved: 0 });
      expect((await listEsignUsage(sql, ws.id))[0]).toMatchObject({ mode: 'own', billed: false });
    });

    it('stops working when the workspace is no longer on a plan that includes it', async () => {
      const ws = await workspace('cloud', 5);
      await saveOwnCredentials(sql, { workspaceId: ws.id, userId: ws.owner.id, credentials });
      await setEsignMode(sql, { workspaceId: ws.id, userId: ws.owner.id, mode: 'own' });
      await sql`update app_workspaces set plan = 'free' where id = ${ws.id}`;
      const blocked = await esignState({ sql, config: () => billingConfig(ENV) }, ws.id);
      expect(blocked.blocked).toMatchObject({ reason: 'own_not_in_plan' });
      const options = createEsignOptions({
        sql,
        config: () => billingConfig(ENV),
        fetch: provider.fetch,
      });
      expect(await options.provider(ws.id)).toBeNull();
      expect((await send(ws)).res.status).toBe(409);
      // The credits are not used silently in its place.
      expect(await creditBalance(sql, ws.id)).toEqual({ available: 5, reserved: 0 });
    });

    it('will not change account while someone is at the provider', async () => {
      const ws = await workspace('cloud', 1);
      await saveOwnCredentials(sql, { workspaceId: ws.id, userId: ws.owner.id, credentials });
      const { email } = await send(ws);
      expect((await start(tokenFor(email))).status).toBe(200);
      await expect(
        setEsignMode(sql, { workspaceId: ws.id, userId: ws.owner.id, mode: 'own' }),
      ).rejects.toThrow(/signing with Aadhaar eSign right now/);
    });
  });

  describe('the settings actions', () => {
    const form = {
      apiKey: 'own-auth-token-9876',
      privateSalt: OWN_SALT,
      workflowId: 'wf_own',
      environment: 'sandbox',
    };

    async function actions() {
      vi.doMock('@/server/esign/runtime', async (original) => {
        const real = await original<typeof import('@/server/esign/runtime')>();
        return {
          ...real,
          providerForCredentials: (c: Parameters<typeof real.providerForCredentials>[0]) =>
            real.providerForCredentials(c, provider.fetch),
        };
      });
      return import('@/server/actions/esign');
    }

    it('lets admins only, and only in their own workspace', async () => {
      const ws = await workspace('cloud');
      const other = await workspace('cloud');
      const { saveEsignCredentialsAction, setEsignModeAction } = await actions();
      for (const role of ['viewer', 'member'] as const) {
        state.user = await member(ws.id, role);
        const refused = await saveEsignCredentialsAction({ workspaceId: ws.id, ...form });
        expect(refused).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      }
      state.user = ws.owner;
      const elsewhere = await setEsignModeAction({ workspaceId: other.id, mode: 'platform' });
      expect(elsewhere).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect((await getEsignSettings(sql, ws.id)).own.configured).toBe(false);
    });

    it('checks the details with the provider, saves them and tests them again', async () => {
      const ws = await workspace('cloud');
      state.user = await member(ws.id, 'admin');
      const {
        saveEsignCredentialsAction,
        setEsignModeAction,
        testEsignConnectionAction,
        removeEsignCredentialsAction,
      } = await actions();

      provider.refuseToken(form.apiKey);
      const refused = await saveEsignCredentialsAction({ workspaceId: ws.id, ...form });
      expect(refused).toMatchObject({ ok: false, field: 'apiKey' });
      expect((await getEsignSettings(sql, ws.id)).own.configured).toBe(false);

      provider.refuseToken(null);
      const saved = await saveEsignCredentialsAction({ workspaceId: ws.id, ...form });
      expect(saved).toMatchObject({
        ok: true,
        data: { own: { configured: true, keyHint: '9876', testOk: true } },
      });
      expect(JSON.stringify(saved)).not.toMatch(/own-auth-token|workspace-private-salt/);

      expect(await setEsignModeAction({ workspaceId: ws.id, mode: 'own' })).toMatchObject({
        ok: true,
        data: { mode: 'own' },
      });
      expect(await testEsignConnectionAction({ workspaceId: ws.id })).toMatchObject({
        ok: true,
        data: { ok: true },
      });
      provider.refuseToken(form.apiKey);
      const failed = await testEsignConnectionAction({ workspaceId: ws.id });
      expect(failed).toMatchObject({ ok: true, data: { ok: false } });
      expect(JSON.stringify(failed)).not.toMatch(/own-auth-token/);

      expect(await removeEsignCredentialsAction({ workspaceId: ws.id })).toMatchObject({
        ok: true,
        data: { mode: 'platform', own: { configured: false, keyHint: null } },
      });
      const audit = await listAudit(sql, ws.id, { prefix: 'esign.' });
      expect(audit.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'esign.credentials_saved',
          'esign.settings_updated',
          'esign.credentials_tested',
          'esign.credentials_removed',
        ]),
      );
      expect(JSON.stringify(audit)).not.toMatch(/own-auth-token|workspace-private-salt/);
    });

    it('keeps your own account for Cloud, with what an upgrade prompt needs', async () => {
      const ws = await workspace('free');
      state.user = ws.owner;
      const { saveEsignCredentialsAction, setEsignModeAction } = await actions();
      for (const result of [
        await saveEsignCredentialsAction({ workspaceId: ws.id, ...form }),
        await setEsignModeAction({ workspaceId: ws.id, mode: 'own' }),
      ]) {
        expect(result).toMatchObject({
          ok: false,
          code: 'PLAN_LIMIT',
          limit: { limit: 'ownEsignAccount', plan: 'free' },
        });
      }
      expect((await getEsignSettings(sql, ws.id)).own.configured).toBe(false);
    });
  });
});
