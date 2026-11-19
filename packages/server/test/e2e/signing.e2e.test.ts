import type { AddressInfo } from 'node:net';
import { verifyChain } from '@codevibe/sign-core';
import { verifySeal } from '@codevibe/sign-pdf';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  listen,
  memoryFileStore,
  memoryStore,
  migrate,
  nodeHasher,
  postgresStore,
  type ServerStore,
} from '../../src/index';
import { makeP12, makePdf } from '../../src/testing/real-pdf';

const API_KEY = 'e2e-key-0123456789abcdef0123456789';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface StoreSetup {
  name: string;
  open(): Promise<{ store: ServerStore; close(): Promise<void> }>;
}

const stores: StoreSetup[] = [
  { name: 'memory', open: async () => ({ store: memoryStore(), close: async () => {} }) },
];
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  stores.push({
    name: 'postgres',
    async open() {
      const schema = `sign_e2e_${process.pid}_${Date.now()}`;
      const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      await admin.unsafe(`create schema ${schema}`);
      const sql = postgres(databaseUrl, {
        max: 4,
        onnotice: () => {},
        connection: { search_path: schema },
      });
      await migrate(sql);
      return {
        store: postgresStore(sql),
        async close() {
          await sql.end();
          await admin.unsafe(`drop schema ${schema} cascade`);
          await admin.end();
        },
      };
    },
  });
}

describe.each(stores)('signing over HTTP ($name store)', (setup) => {
  const mailer = consoleMailer({ silent: true });
  const otp = consoleOtpSender({ silent: true });
  let base = '';
  let shutdown: () => Promise<void> = async () => {};
  let pdf: Uint8Array;

  beforeAll(async () => {
    pdf = await makePdf(2);
    const { store, close } = await setup.open();
    const sign = createSignServer({
      store,
      files: memoryFileStore(),
      mailer,
      otp,
      sealer: { p12: makeP12('E2E Seal', 'pw'), passphrase: 'pw', reason: 'Signed' },
      apiKeys: [API_KEY],
      publicUrl: 'https://sign.example.com',
    });
    const http = await listen(sign.app, { port: 0, hostname: '127.0.0.1' });
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    shutdown = async () => {
      await new Promise((resolve) => http.close(resolve));
      await sign.idle();
      await close();
    };
  });

  afterAll(() => shutdown());

  async function api(method: string, path: string, body?: unknown, headers = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(path.startsWith('/v1/envelopes') ? { authorization: `Bearer ${API_KEY}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return res;
  }
  async function json(method: string, path: string, body?: unknown, headers = {}) {
    const res = await api(method, path, body, headers);
    // Response bodies are checked field by field below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json()) as any, res };
  }
  function tokenFor(email: string): string {
    const mail = [...mailer.sent].reverse().find((m) => m.to === email && /\/sign\//.test(m.text));
    const token = mail?.text.match(/\/sign\/([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`No signing link sent to ${email}`);
    return token;
  }

  it('sends, signs with OTP, seals and verifies a real PDF', async () => {
    const created = await json('POST', '/v1/envelopes', {
      title: 'Offer letter',
      routing: 'sequential',
      documents: [{ name: 'offer.pdf', content: Buffer.from(pdf).toString('base64') }],
      recipients: [
        { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
        { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com' },
      ],
    });
    expect(created.status).toBe(201);
    const envelope = created.body;
    expect(envelope.status).toBe('draft');
    const [asha, ravi] = envelope.recipients;
    const docId = envelope.documents[0].id;

    const placed = await json('PATCH', `/v1/envelopes/${envelope.id}`, {
      fields: [
        { recipient: asha.id, type: 'signature', page: 1, x: 72, y: 600, width: 180, height: 48 },
        { recipient: ravi.id, type: 'signature', page: 1, x: 320, y: 600, width: 180, height: 48 },
        {
          recipient: ravi.id,
          type: 'date_signed',
          page: 1,
          x: 320,
          y: 660,
          width: 120,
          height: 16,
        },
      ],
    });
    expect(placed.status).toBe(200);
    expect(placed.body.fields).toHaveLength(3);

    const sent = await json('POST', `/v1/envelopes/${envelope.id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('sent');

    const ashaToken = tokenFor('asha@example.com');
    expect(() => tokenFor('ravi@example.com')).toThrow();
    const locked = await json('POST', `/v1/sign/${ashaToken}/view`);
    expect(locked.body.error.code).toBe('OTP_INVALID');

    expect((await json('POST', `/v1/sign/${ashaToken}/otp`)).status).toBe(200);
    const code = otp.sent.at(-1)?.code;
    expect(code).toMatch(/^\d{6}$/);
    const verified = await json('POST', `/v1/sign/${ashaToken}/otp/verify`, { code });
    expect(verified.status).toBe(200);
    expect(verified.res.headers.get('set-cookie')).toContain('cvsign_session=');
    const session = { 'x-sign-session': verified.body.sessionToken as string };

    const view = await json('GET', `/v1/sign/${ashaToken}`, undefined, session);
    const ashaField = view.body.fields[0].id;
    const original = await api(
      'GET',
      `/v1/sign/${ashaToken}/documents/${docId}`,
      undefined,
      session,
    );
    expect(Buffer.from(await original.arrayBuffer()).equals(Buffer.from(pdf))).toBe(true);
    expect((await json('POST', `/v1/sign/${ashaToken}/view`, undefined, session)).status).toBe(200);

    const noConsent = await json(
      'POST',
      `/v1/sign/${ashaToken}/submit`,
      { values: [{ fieldId: ashaField, value: PNG }] },
      session,
    );
    expect(noConsent.status).toBe(400);
    const ashaDone = await json(
      'POST',
      `/v1/sign/${ashaToken}/submit`,
      { consent: true, values: [{ fieldId: ashaField, value: PNG }] },
      session,
    );
    expect(ashaDone.body).toMatchObject({ recipientStatus: 'signed' });

    const raviToken = tokenFor('ravi@example.com');
    const raviView = await json('GET', `/v1/sign/${raviToken}`);
    const raviSignature = raviView.body.fields.find(
      (f: { type: string }) => f.type === 'signature',
    );
    const raviDone = await json('POST', `/v1/sign/${raviToken}/submit`, {
      consent: true,
      values: [{ fieldId: raviSignature.id, value: PNG }],
    });
    expect(raviDone.body).toEqual({ envelopeStatus: 'completed', recipientStatus: 'signed' });
    expect((await json('GET', `/v1/sign/${raviToken}`)).status).toBeGreaterThanOrEqual(400);

    const sealedRes = await api('GET', `/v1/envelopes/${envelope.id}/documents/${docId}`);
    expect(sealedRes.status).toBe(200);
    const sealed = new Uint8Array(await sealedRes.arrayBuffer());
    expect(await verifySeal(sealed)).toMatchObject({
      sealed: true,
      valid: true,
      coversWholeDocument: true,
      signer: { commonName: 'E2E Seal' },
    });

    const events = await json('GET', `/v1/envelopes/${envelope.id}/events`);
    expect(events.body.chainValid).toBe(true);
    const final = await json('GET', `/v1/envelopes/${envelope.id}`);
    expect(final.body.status).toBe('completed');
    const chain = await verifyChain(events.body.events, nodeHasher);
    expect(chain.valid).toBe(true);
    expect(events.body.events.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['envelope.sent', 'recipient.signed', 'envelope.completed']),
    );

    const tampered = new Uint8Array(sealed);
    const at = Math.floor(tampered.length / 3);
    tampered[at] = tampered[at]! ^ 0xff;
    const broken = await verifySeal(tampered);
    expect(broken.valid && broken.coversWholeDocument).toBe(false);

    const appended = new Uint8Array([...sealed, ...Buffer.from('\n% appended\n')]);
    expect((await verifySeal(appended)).coversWholeDocument).toBe(false);

    const forged = structuredClone(events.body.events);
    forged[1].at = '2020-01-01T00:00:00.000Z';
    expect((await verifyChain(forged, nodeHasher)).valid).toBe(false);
  }, 120_000);
});
