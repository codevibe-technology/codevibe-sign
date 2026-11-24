import { SignError } from '@codevibe_technology/sign-core';
import { describe, expect, it } from 'vitest';
import type { SignServerOptions } from '../options';
import { fakeEsignProvider, type FakeEsignProvider } from '../testing/fake-esign';
import { fakePdfEngine } from '../testing/fake-pdf';
import { envelopeBody, harness, PNG } from '../testing/harness';
import type { EsignOptions } from './types';

const HOUR = 60 * 60 * 1000;
const WEBHOOK = '/v1/esign/webhooks/leegality';

const people = {
  asha: { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' },
  ravi: { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', auth: 'aadhaar' },
};
const signature = (recipient: string, x: number, type = 'signature') => ({
  recipient,
  type,
  page: 1,
  x,
  y: 600,
  width: 180,
  height: 48,
});
const box = (recipient: string, x: number) => signature(recipient, x, 'aadhaar');
const title = (recipient: string) => ({ ...signature(recipient, 72, 'text'), y: 700 });

/** Asha signs by email link, then Ravi with Aadhaar eSign, who has no fields. */
const aadhaarBody = (overrides: Record<string, unknown> = {}) =>
  envelopeBody({
    send: true,
    recipients: [people.asha, people.ravi],
    fields: [signature('asha', 72), title('asha')],
    ...overrides,
  });

interface Setup {
  esign?: Partial<EsignOptions>;
  server?: Partial<SignServerOptions>;
  provider?: FakeEsignProvider;
}

function setup(options: Setup = {}) {
  const provider = options.provider ?? fakeEsignProvider();
  const hooks: string[] = [];
  const h = harness({
    esign: {
      provider: async () => provider,
      onStart: async () => {
        hooks.push('start');
      },
      onEnd: async ({ outcome }) => {
        hooks.push(outcome);
      },
      ...options.esign,
    },
    ...options.server,
  });
  return { h, provider, hooks };
}

type Harness = ReturnType<typeof harness>;
interface Api {
  id: string;
  recipients: { id: string; email: string }[];
  fields: { id: string; recipientId: string; type: string }[];
  documents: { id: string }[];
}

function valuesOf(envelope: Api, email: string) {
  const recipient = envelope.recipients.find((r) => r.email === email)!;
  return envelope.fields
    .filter((f) => f.recipientId === recipient.id && f.type !== 'aadhaar')
    .map((f) => ({ fieldId: f.id, value: f.type === 'text' ? 'Manager' : PNG }));
}

/** Sends the envelope and has Asha sign, so it is Ravi's turn. */
async function readyForRavi(h: Harness, overrides: Record<string, unknown> = {}) {
  const created = await h.call('POST', '/v1/envelopes', { body: aadhaarBody(overrides) });
  expect(created.status).toBe(201);
  const envelope = created.json as Api;
  const asha = await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
    body: { consent: true, values: valuesOf(envelope, 'asha@example.com') },
  });
  expect(asha.status).toBe(200);
  const token = h.tokenFor('ravi@example.com');
  const start = () =>
    h.call('POST', `/v1/sign/${token}/esign`, {
      body: { consent: true, values: valuesOf(envelope, 'ravi@example.com') },
    });
  return { envelope, token, start };
}

const actions = async (h: Harness, id: string) =>
  ((await h.call('GET', `/v1/envelopes/${id}/events`)).json.events as { action: string }[]).map(
    (e) => e.action,
  );
const count = (list: string[], item: string) => list.filter((x) => x === item).length;
const statusOf = async (h: Harness, id: string) =>
  (await h.call('GET', `/v1/envelopes/${id}`)).json as {
    status: string;
    recipients: { email: string; status: string; esign?: Record<string, unknown> }[];
  };

describe('sending with an Aadhaar signer', () => {
  it('refuses to send when the server has no eSign set up', async () => {
    const h = harness();
    const { status, json } = await h.call('POST', '/v1/envelopes', { body: aadhaarBody() });
    expect(status).toBe(409);
    expect(json.error).toMatchObject({
      code: 'ESIGN_UNAVAILABLE',
      details: { reason: 'not_configured' },
    });
    const draft = await h.call('POST', '/v1/envelopes', { body: aadhaarBody({ send: false }) });
    expect(draft.status).toBe(201);
    const sent = await h.call('POST', `/v1/envelopes/${draft.json.id}/send`);
    expect(sent.json.error.code).toBe('ESIGN_UNAVAILABLE');
    expect((await h.call('GET', `/v1/envelopes/${draft.json.id}`)).json.status).toBe('draft');
  });

  it('refuses to send when the workspace cannot eSign, with the reason', async () => {
    const { h } = setup({
      esign: {
        available: async () => ({ reason: 'no_credits', message: 'Buy eSign credits first' }),
      },
    });
    const { status, json } = await h.call('POST', '/v1/envelopes', { body: aadhaarBody() });
    expect(status).toBe(409);
    expect(json.error).toMatchObject({
      code: 'ESIGN_UNAVAILABLE',
      message: 'Buy eSign credits first',
      details: { reason: 'no_credits' },
    });
  });

  it.each([
    [
      'an Aadhaar signer who is not last',
      { recipients: [people.ravi, people.asha] },
      'must be the last to act',
    ],
    ['parallel routing with someone else', { routing: 'parallel' }, 'use sequential routing'],
    [
      'two Aadhaar signers',
      { recipients: [{ ...people.asha, auth: 'aadhaar' }, people.ravi] },
      'Only one recipient',
    ],
    [
      'two documents',
      {
        documents: [
          { key: 'offer', name: 'offer.pdf', content: envelopeBody().documents[0]!.content },
          { key: 'nda', name: 'nda.pdf', content: envelopeBody().documents[0]!.content },
        ],
        fields: [
          { ...signature('asha', 72), document: 'offer' },
          { ...signature('ravi', 300), document: 'offer' },
        ],
      },
      'can hold one document',
    ],
    [
      'a field to fill in for the Aadhaar signer',
      { fields: [signature('asha', 72), title('ravi')] },
      'Ravi Kumar signs with Aadhaar eSign and fills in nothing here',
    ],
    [
      'two Aadhaar seal positions',
      { fields: [signature('asha', 72), box('ravi', 300), { ...box('ravi', 300), y: 100 }] },
      'Ravi Kumar can have one Aadhaar seal position; remove this extra box',
    ],
    [
      'an Aadhaar eSign box for someone who signs by email',
      { fields: [signature('asha', 72), box('asha', 72)] },
      'Only a signer who uses Aadhaar eSign',
    ],
    [
      'an Aadhaar approver',
      {
        recipients: [people.asha, { ...people.ravi, role: 'approver' }],
        fields: [signature('asha', 72)],
      },
      'is for signers',
    ],
  ])('refuses %s, when created and when sent', async (_name, overrides, message) => {
    const { h } = setup();
    const direct = await h.call('POST', '/v1/envelopes', { body: aadhaarBody(overrides) });
    expect(direct.status).toBe(400);
    expect(JSON.stringify(direct.json.error)).toContain(message);
    const draft = await h.call('POST', '/v1/envelopes', {
      body: aadhaarBody({ ...overrides, send: false }),
    });
    expect(draft.status).toBe(201);
    const sent = await h.call('POST', `/v1/envelopes/${draft.json.id}/send`);
    expect(sent.status).toBe(400);
    expect(JSON.stringify(sent.json.error)).toContain(message);
  });

  it('lets one Aadhaar signer sign alone', async () => {
    const { h } = setup();
    const { status } = await h.call('POST', '/v1/envelopes', {
      body: aadhaarBody({ recipients: [people.ravi], fields: [] }),
    });
    expect(status).toBe(201);
  });

  it('drops the signature and initials an older request gives the Aadhaar signer', async () => {
    const { h } = setup();
    const older = [
      signature('asha', 72),
      signature('ravi', 300),
      signature('ravi', 300, 'initials'),
    ];
    const created = await h.call('POST', '/v1/envelopes', {
      body: aadhaarBody({ fields: older }),
    });
    expect(created.status).toBe(201);
    expect((created.json as Api).fields.map((f) => f.type)).toEqual(['signature']);
    const draft = await h.call('POST', '/v1/envelopes', {
      body: aadhaarBody({ send: false, fields: older }),
    });
    expect((draft.json as Api).fields).toHaveLength(3);
    const sent = await h.call('POST', `/v1/envelopes/${draft.json.id}/send`);
    expect(sent.status).toBe(200);
    expect((sent.json as Api).fields.map((f) => f.type)).toEqual(['signature']);
  });

  it('keeps one Aadhaar seal position as the place of the signature', async () => {
    const { h } = setup();
    const fields = [signature('asha', 72), signature('ravi', 300), box('ravi', 300)];
    const created = await h.call('POST', '/v1/envelopes', { body: aadhaarBody({ fields }) });
    expect(created.status).toBe(201);
    expect((created.json as Api).fields.map((f) => f.type)).toEqual(['signature', 'aadhaar']);
    const draft = await h.call('POST', '/v1/envelopes', {
      body: aadhaarBody({ send: false, fields }),
    });
    const sent = await h.call('POST', `/v1/envelopes/${draft.json.id}/send`);
    expect((sent.json as Api).fields.map((f) => f.type)).toEqual(['signature', 'aadhaar']);
  });
});

describe('POST /v1/sign/:token/esign', () => {
  it('passes the Aadhaar seal position to the provider and draws nothing for it', async () => {
    const { h, provider } = setup();
    const { start } = await readyForRavi(h, {
      fields: [signature('asha', 72), title('asha'), box('ravi', 300)],
    });
    expect((await start()).status).toBe(200);
    const { request } = provider.requests[0]!;
    expect(request.signaturePositions).toEqual([
      {
        page: 1,
        rect: { x: 300, y: 600, width: 180, height: 48 },
        pageBox: { x: 0, y: 0, width: 612, height: 792, rotation: 0 },
      },
    ]);
    // Only Asha's two fields are drawn: the box is a position, not a field.
    expect(new TextDecoder().decode(request.documentBytes)).toMatch(/fields=2;values=2\n$/);
  });

  it('gives the provider the crop box and rotation of the page', async () => {
    const box90 = { x: 10, y: 20, width: 595, height: 842, rotation: 90 as const };
    const engine = fakePdfEngine();
    const { h, provider } = setup({
      server: {
        pdf: {
          ...engine,
          inspectPdf: async (pdf, options) => ({
            ...(await engine.inspectPdf(pdf, options)),
            boxes: [{ ...box90, rotation: 0 }, box90],
          }),
        },
      },
    });
    const { start } = await readyForRavi(h, {
      fields: [signature('asha', 72), title('asha'), box('ravi', 300)],
    });
    await start();
    expect(provider.requests[0]!.request.signaturePositions?.[0]?.pageBox).toEqual(box90);
  });

  it('sends the signer to the provider with the filled file and reserves once', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token, start } = await readyForRavi(h);

    const view = await h.call('GET', `/v1/sign/${token}`);
    expect(view.json.esign).toEqual({ available: true, provider: null, status: null });

    const started = await start();
    expect(started.status).toBe(200);
    expect(started.json.signUrl).toBe('https://esign.example.com/sign/salt-doc-1');
    expect(provider.requests).toHaveLength(1);
    const { request } = provider.requests[0]!;
    expect(request.recipient).toEqual({ name: 'Ravi Kumar', email: 'ravi@example.com' });
    expect(request.callbackUrl).toBe('https://sign.example.com/v1/esign/webhooks/leegality');
    expect(request.redirectUrl).toBe('https://sign.example.com/sign?esign=return');
    expect(request.reference).not.toBe(envelope.id);
    // Asha's two fields are drawn; nothing is added for Ravi, no box and no certificate page.
    expect(new TextDecoder().decode(request.documentBytes)).toMatch(/fields=2;values=2\n$/);
    expect(request.signaturePositions).toBeUndefined();
    expect(hooks).toEqual(['start']);

    const again = await start();
    expect(again.json).toEqual(started.json);
    expect(provider.requests).toHaveLength(1);
    expect(hooks).toEqual(['start']);

    const current = await statusOf(h, envelope.id);
    expect(current.status).toBe('in_progress');
    expect(current.recipients[1]).toMatchObject({
      status: expect.not.stringMatching('signed'),
      esign: { provider: 'leegality', status: 'pending' },
    });
    expect(count(await actions(h, envelope.id), 'recipient.esign_started')).toBe(1);
    expect((await h.call('GET', `/v1/sign/${token}`)).json.esign).toEqual({
      available: true,
      provider: 'leegality',
      status: 'pending',
    });
    const status = await h.call('GET', `/v1/sign/${token}/esign`);
    expect(status.json).toMatchObject({ status: 'pending', signUrl: started.json.signUrl });
  });

  it('sends the document exactly as uploaded when nobody fills anything in first', async () => {
    const { h, provider } = setup();
    const body = aadhaarBody({ recipients: [people.ravi], fields: [] });
    const created = await h.call('POST', '/v1/envelopes', { body });
    expect(created.status).toBe(201);
    const token = h.tokenFor('ravi@example.com');
    const started = await h.call('POST', `/v1/sign/${token}/esign`, {
      body: { consent: true, values: [] },
    });
    expect(started.status).toBe(200);
    const sent = provider.requests[0]!.request.documentBytes;
    const uploaded = Buffer.from(body.documents[0]!.content, 'base64');
    expect(Buffer.from(sent).equals(uploaded)).toBe(true);
  });

  it('needs consent, only the values of the signer and the right recipient', async () => {
    const { h, provider } = setup();
    const { envelope, token } = await readyForRavi(h);
    const values = valuesOf(envelope, 'ravi@example.com');
    const noConsent = await h.call('POST', `/v1/sign/${token}/esign`, { body: { values } });
    expect(noConsent.status).toBe(400);
    const others = await h.call('POST', `/v1/sign/${token}/esign`, {
      body: { consent: true, values: valuesOf(envelope, 'asha@example.com') },
    });
    expect(others.json.error.code).toBe('FIELD_NOT_YOURS');
    const plain = await h.call('POST', `/v1/sign/${token}/submit`, {
      body: { consent: true, values },
    });
    expect(plain.status).toBe(400);
    expect(plain.json.error.message).toContain('Aadhaar eSign');
    expect(provider.requests).toHaveLength(0);
    expect((await h.call('GET', `/v1/sign/${token}/esign`)).json).toEqual({
      status: 'none',
      signUrl: null,
      expiresAt: null,
    });
  });

  it('refuses a recipient who does not sign with Aadhaar, and one whose turn it is not', async () => {
    const { h, provider } = setup();
    const created = await h.call('POST', '/v1/envelopes', { body: aadhaarBody() });
    const envelope = created.json as Api;
    const asha = await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/esign`, {
      body: { consent: true, values: valuesOf(envelope, 'asha@example.com') },
    });
    expect(asha.status).toBe(400);
    expect(provider.requests).toHaveLength(0);

    const parallel = await h.call('POST', '/v1/envelopes', {
      body: aadhaarBody({ recipients: [people.ravi], fields: [signature('ravi', 300)] }),
    });
    expect(parallel.status).toBe(201);
    expect(provider.requests).toHaveLength(0);
  });

  it('tells the signer when the workspace cannot eSign and records why', async () => {
    let blocked = false;
    const { h, provider, hooks } = setup({
      esign: {
        available: async () =>
          blocked
            ? {
                reason: 'no_credits',
                message: 'Buy eSign credits first',
                signerMessage: 'Ask the sender to top up.',
              }
            : null,
      },
    });
    const { envelope, start } = await readyForRavi(h);
    blocked = true;
    const refused = await start();
    expect(refused.status).toBe(409);
    expect(refused.json.error).toMatchObject({
      code: 'ESIGN_UNAVAILABLE',
      message: 'Ask the sender to top up.',
      details: { reason: 'no_credits' },
    });
    expect(provider.requests).toHaveLength(0);
    expect(hooks).toEqual([]);
    const events = (await h.call('GET', `/v1/envelopes/${envelope.id}/events`)).json.events as {
      action: string;
      data?: Record<string, unknown>;
    }[];
    expect(events.at(-1)).toMatchObject({
      action: 'recipient.esign_failed',
      data: { reason: 'no_credits' },
    });
  });

  it('starts nothing when onStart refuses, and can start once it allows', async () => {
    let credits = 0;
    const { h, provider, hooks } = setup({
      esign: {
        onStart: async () => {
          if (credits === 0) {
            throw new SignError('ESIGN_UNAVAILABLE', 'No eSign credits are left.', {
              reason: 'no_credits',
            });
          }
          credits -= 1;
        },
      },
    });
    const { start } = await readyForRavi(h);
    const refused = await start();
    expect(refused.json.error).toMatchObject({
      code: 'ESIGN_UNAVAILABLE',
      message: 'No eSign credits are left.',
      details: { reason: 'no_credits' },
    });
    expect(provider.requests).toHaveLength(0);
    expect(hooks).toEqual([]);
    credits = 1;
    expect((await start()).status).toBe(200);
    expect(credits).toBe(0);
  });

  it('gives back what was reserved when the provider fails, and lets the signer retry', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, start } = await readyForRavi(h);
    provider.failNextCreate();
    const failed = await start();
    expect(failed.status).toBe(502);
    expect(failed.json.error.code).toBe('PROVIDER_ERROR');
    expect(hooks).toEqual(['start', 'failed']);
    expect(await actions(h, envelope.id)).toContain('recipient.esign_failed');
    expect(JSON.stringify(h.logs)).not.toContain(PNG);

    expect((await start()).status).toBe(200);
    expect(hooks).toEqual(['start', 'failed', 'start']);
  });

  it('limits how often one signer can start', async () => {
    const { h, provider } = setup();
    const { start } = await readyForRavi(h);
    for (let i = 0; i < 5; i++) {
      provider.failNextCreate();
      expect((await start()).status).toBe(502);
    }
    const limited = await start();
    expect(limited.status).toBe(429);
  });
});

describe('the provider reports back', () => {
  it('signs through the webhook, completes the envelope and settles once', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    const body = provider.webhook(ref, 'signed', 'RAVI KUMAR');

    const hook = await h.call('POST', WEBHOOK, { body });
    expect(hook.status).toBe(200);
    expect(hook.json).toEqual({ ok: true });

    const done = await statusOf(h, envelope.id);
    expect(done.status).toBe('completed');
    expect(done.recipients[1]).toMatchObject({
      status: 'signed',
      esign: { provider: 'leegality', status: 'signed', signerName: 'RAVI KUMAR' },
    });
    expect(hooks).toEqual(['start', 'signed']);

    const replay = await h.call('POST', WEBHOOK, { body });
    expect(replay.status).toBe(200);
    expect(hooks).toEqual(['start', 'signed']);
    const log = await actions(h, envelope.id);
    expect(count(log, 'recipient.signed')).toBe(2);
    expect(count(log, 'envelope.completed')).toBe(1);
    expect(count(log, 'document.sealed')).toBe(1);

    const events = (await h.call('GET', `/v1/envelopes/${envelope.id}/events`)).json.events as {
      action: string;
      recipientId?: string;
      data?: Record<string, unknown>;
    }[];
    const signed = events.filter((e) => e.action === 'recipient.signed').at(-1)!;
    expect(signed.data).toMatchObject({
      method: 'aadhaar_esign',
      provider: 'leegality',
      providerRef: ref,
      signerName: 'RAVI KUMAR',
    });

    const status = await h.call('GET', `/v1/sign/${token}/esign`);
    expect(status.json).toEqual({ status: 'signed', signUrl: null, expiresAt: null });
    const receipt = status.res.headers.get('x-sign-receipt')!;
    const summary = await h.call('GET', '/v1/sign/receipt', {
      headers: { 'x-sign-receipt': receipt },
    });
    expect(summary.json.recipient).toMatchObject({ name: 'Ravi Kumar', status: 'signed' });
  });

  it('signs through the status check when no webhook ever comes', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    expect((await h.call('GET', `/v1/sign/${token}/esign`)).json.status).toBe('pending');
    provider.finish(provider.requests[0]!.ref);
    // Checked a moment ago, so the provider is not asked again yet.
    expect((await h.call('GET', `/v1/sign/${token}/esign`)).json.status).toBe('pending');
    h.advance(11_000);
    const status = await h.call('GET', `/v1/sign/${token}/esign`);
    expect(status.json.status).toBe('signed');
    expect(status.res.headers.get('x-sign-receipt')).toBeTruthy();
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
    expect(hooks).toEqual(['start', 'signed']);
  });

  it('acts once when the webhook and the status check arrive together', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    h.advance(11_000);
    const body = provider.webhook(ref, 'signed');
    const results = await Promise.all([
      h.call('POST', WEBHOOK, { body }),
      h.call('GET', `/v1/sign/${token}/esign`),
      h.call('POST', WEBHOOK, { body }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    await h.server.idle();
    expect(count(hooks, 'signed')).toBe(1);
    const log = await actions(h, envelope.id);
    expect(count(log, 'recipient.signed')).toBe(2);
    expect(count(log, 'envelope.completed')).toBe(1);
    expect(count(log, 'document.sealed')).toBe(1);
  });

  it('declines the envelope when the signer declines at the provider', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref, 'declined');
    const hook = await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'declined') });
    expect(hook.status).toBe(200);
    const after = await statusOf(h, envelope.id);
    expect(after.status).toBe('declined');
    expect(after.recipients[1]).toMatchObject({
      status: 'declined',
      esign: { status: 'declined' },
    });
    expect(hooks).toEqual(['start', 'declined']);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'declined') });
    expect(hooks).toEqual(['start', 'declined']);
  });

  it('lets the signer start again after the provider reports a failure', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, start } = await readyForRavi(h);
    const first = await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref, 'failed');
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'failed') });
    expect(hooks).toEqual(['start', 'failed']);
    expect((await statusOf(h, envelope.id)).recipients[1]!.esign).toMatchObject({
      status: 'failed',
    });
    const second = await start();
    expect(second.status).toBe(200);
    expect(second.json.signUrl).not.toBe(first.json.signUrl);
    expect(hooks).toEqual(['start', 'failed', 'start']);
  });

  it('refuses a webhook with the wrong mac and changes nothing', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    const forged = JSON.stringify({ documentId: ref, mac: `guess:${ref}`, status: 'signed' });
    const hook = await h.call('POST', WEBHOOK, { body: forged });
    expect(hook.status).toBe(401);
    expect(hook.json.error.code).toBe('UNAUTHORIZED');
    expect((await statusOf(h, envelope.id)).status).toBe('in_progress');
    expect(hooks).toEqual(['start']);
  });

  it('refuses a webhook that claims a status the provider does not confirm', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    const hook = await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hook.status).toBe(401);
    expect((await statusOf(h, envelope.id)).status).toBe('in_progress');
    expect(hooks).toEqual(['start']);
  });

  it('answers 404 to unknown references, unknown providers and junk', async () => {
    const { h, provider } = setup();
    const { start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    const unknown = await h.call('POST', WEBHOOK, { body: provider.webhook('nope', 'signed') });
    expect(unknown.status).toBe(404);
    const other = await h.call('POST', '/v1/esign/webhooks/emudhra', {
      body: provider.webhook(ref, 'signed'),
    });
    expect(other.status).toBe(404);
    expect((await h.call('POST', WEBHOOK, { body: 'not json' })).status).toBe(404);
    expect((await h.call('POST', '/v1/esign/webhooks/Bad%20Name', { body: '{}' })).status).toBe(
      404,
    );
    const bare = harness();
    expect(
      (await bare.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') })).status,
    ).toBe(404);
  });

  it('refuses a body over the size limit', async () => {
    const { h } = setup();
    const big = JSON.stringify({ documentId: 'x', pad: 'a'.repeat(300 * 1024) });
    expect((await h.call('POST', WEBHOOK, { body: big })).status).toBe(413);
  });

  it('verifies a webhook with the credentials of the workspace that started the request', async () => {
    const mine = fakeEsignProvider({ secret: 'mine' });
    const theirs = fakeEsignProvider({ secret: 'theirs' });
    const asked: string[] = [];
    const { h, hooks } = setup({
      esign: {
        provider: async (workspaceId) => {
          asked.push(workspaceId);
          return mine;
        },
      },
    });
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = mine.requests[0]!.ref;
    mine.finish(ref);
    // Signed with another account's secret: valid there, not here.
    const hook = await h.call('POST', WEBHOOK, { body: theirs.webhook(ref, 'signed') });
    expect(hook.status).toBe(401);
    expect(new Set(asked)).toEqual(new Set(['default']));
    expect((await statusOf(h, envelope.id)).status).toBe('in_progress');
    expect((await h.call('POST', WEBHOOK, { body: mine.webhook(ref, 'signed') })).status).toBe(200);
    expect(hooks).toEqual(['start', 'signed']);
  });

  it('keeps a started request on the account it began with when the workspace changes', async () => {
    const first = fakeEsignProvider({ secret: 'first' });
    const second = fakeEsignProvider({ secret: 'second' });
    let current: FakeEsignProvider | null = first;
    const started = new Map<string, FakeEsignProvider>();
    const { h, hooks } = setup({
      esign: {
        provider: async () => current,
        onStart: async ({ ref }) => {
          hooks.push('start');
          started.set(ref, first);
        },
        providerForSession: async ({ ref }) => started.get(ref) ?? null,
      },
    });
    const { envelope, token, start } = await readyForRavi(h);
    expect((await start()).status).toBe(200);
    const ref = first.requests[0]!.ref;
    // The workspace moves to another account, then loses eSign altogether.
    current = second;
    first.finish(ref);
    expect((await h.call('POST', WEBHOOK, { body: second.webhook(ref, 'signed') })).status).toBe(
      401,
    );
    current = null;
    const polled = await h.call('GET', `/v1/sign/${token}/esign`);
    expect(polled.json.status).toBe('signed');
    expect(second.requests).toHaveLength(0);
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
    expect(hooks).toEqual(['start', 'signed']);
  });

  it('starts nothing when the account settled on at the hold is not the one first seen', async () => {
    const first = fakeEsignProvider({ name: 'leegality' });
    const { h, hooks } = setup({
      provider: first,
      esign: { providerForSession: async () => null },
    });
    const { start } = await readyForRavi(h);
    const answer = await start();
    expect(answer.status).toBe(502);
    expect(first.requests).toHaveLength(0);
    expect(hooks).toEqual(['start', 'failed']);
  });
});

describe('time and the envelope around an eSign', () => {
  it('expires a session after a last look and lets the signer start again', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    const before = provider.fetches;
    h.advance(25 * HOUR);
    await h.server.tick();
    expect(provider.fetches).toBe(before + 1);
    expect(hooks).toEqual(['start', 'expired']);
    expect((await statusOf(h, envelope.id)).recipients[1]!.esign).toMatchObject({
      status: 'expired',
    });
    expect(await actions(h, envelope.id)).toContain('recipient.esign_failed');
    expect((await h.call('GET', `/v1/sign/${token}/esign`)).json.status).toBe('expired');
    await h.server.tick();
    expect(hooks).toEqual(['start', 'expired']);

    expect((await start()).status).toBe(200);
    expect(provider.requests).toHaveLength(2);
  });

  it('completes on the last look when the signature was never reported', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, start } = await readyForRavi(h);
    await start();
    provider.finish(provider.requests[0]!.ref);
    h.advance(25 * HOUR);
    await h.server.tick();
    expect(hooks).toEqual(['start', 'signed']);
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
  });

  it('honours a signature reported after the session expired', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    h.advance(25 * HOUR);
    await h.server.tick();
    expect(hooks).toEqual(['start', 'expired']);
    provider.finish(ref);
    const hook = await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hook.status).toBe(200);
    expect(hooks).toEqual(['start', 'expired', 'signed']);
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(count(hooks, 'signed')).toBe(1);
  });

  it('closes the session when the sender voids the envelope', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    const voided = await h.call('POST', `/v1/envelopes/${envelope.id}/void`, {
      body: { reason: 'Sent by mistake' },
    });
    expect(voided.json.status).toBe('voided');
    expect(hooks).toEqual(['start', 'failed']);
    expect((await h.call('GET', `/v1/sign/${token}/esign`)).status).toBe(401);

    // The provider did the work anyway: it is settled, but the envelope stays voided.
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hooks).toEqual(['start', 'failed', 'signed']);
    const after = await statusOf(h, envelope.id);
    expect(after.status).toBe('voided');
    expect(after.recipients[1]!.status).not.toBe('signed');
  });

  it('closes the session when the envelope expires', async () => {
    const { h, hooks } = setup();
    const expiresAt = new Date('2026-03-04T09:00:00.000Z').toISOString();
    const { envelope, start } = await readyForRavi(h, { expiresAt });
    const started = await start();
    expect(started.json.expiresAt).toBe('2026-03-03T09:00:00.000Z');
    h.advance(49 * HOUR);
    await h.server.tick();
    expect((await statusOf(h, envelope.id)).status).toBe('expired');
    expect(count(hooks, 'expired')).toBe(1);
    expect(hooks).toHaveLength(2);
  });

  it('retries an outcome the hook did not take', async () => {
    let fail = true;
    const heard: string[] = [];
    const { h, provider } = setup({
      esign: {
        onEnd: async ({ outcome }) => {
          if (fail) throw new Error('database is away');
          heard.push(outcome);
        },
      },
    });
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    const hook = await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hook.status).toBe(200);
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
    expect(heard).toEqual([]);
    fail = false;
    await h.server.tick();
    expect(heard).toEqual(['signed']);
    await h.server.tick();
    expect(heard).toEqual(['signed']);
  });
});

describe('the name on the eSign certificate', () => {
  async function signedAs(certificateName: string, reported?: string) {
    const engine = fakePdfEngine({
      async verifySignatures() {
        return [
          {
            valid: true,
            coversWholeDocument: true,
            signer: { commonName: certificateName },
            issuer: { commonName: 'Test ESP CA' },
          },
        ];
      },
    });
    const { h, provider } = setup({ server: { pdf: engine } });
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed', reported) });
    const events = (await h.call('GET', `/v1/envelopes/${envelope.id}/events`)).json.events as {
      action: string;
      recipientId?: string;
      data?: Record<string, unknown>;
    }[];
    return { h, envelope, events, done: await statusOf(h, envelope.id) };
  }

  it('takes the name from the signed file over the name the provider reports', async () => {
    const { events, done } = await signedAs('RAVI S KUMAR', 'Shubham Dhall');
    expect(done.recipients[1]!.esign).toMatchObject({ signerName: 'RAVI S KUMAR' });
    expect(events.filter((e) => e.action === 'recipient.signed').at(-1)!.data).toMatchObject({
      signerName: 'RAVI S KUMAR',
      providerSignerName: 'Shubham Dhall',
    });
    expect(events.map((e) => e.action)).not.toContain('recipient.esign_name_differs');
    expect(JSON.stringify(events)).not.toContain('"signerName":"Shubham Dhall"');
  });

  it('notes a name that is not the recipient, and still completes', async () => {
    const { events, done } = await signedAs('PRAKRITI S IYER', 'Prakriti S Iyer');
    expect(done.status).toBe('completed');
    const signed = events.findIndex((e) => e.action === 'recipient.signed' && e.data?.method);
    expect(events[signed + 1]).toMatchObject({
      action: 'recipient.esign_name_differs',
      recipientId: expect.any(String),
      data: { recipientName: 'Ravi Kumar', certificateName: 'PRAKRITI S IYER' },
    });
    expect(events.filter((e) => e.action === 'recipient.signed').at(-1)!.data).not.toHaveProperty(
      'providerSignerName',
    );
  });
});

describe('sealing after an eSign', () => {
  const engine = (overrides: Parameters<typeof fakePdfEngine>[0] = {}) => {
    const calls: string[] = [];
    const tail = (pdf: Uint8Array, text: string) =>
      new Uint8Array([...pdf, ...new TextEncoder().encode(text)]);
    return {
      calls,
      pdf: fakePdfEngine({
        async countersign(pdf) {
          calls.push('countersign');
          return tail(pdf, 'countersigned\n');
        },
        async verifySignatures() {
          return [
            {
              valid: true,
              coversWholeDocument: true,
              signer: { commonName: 'RAVI KUMAR' },
              issuer: { commonName: 'Test ESP CA' },
              signedAt: '2026-11-24T10:00:00.000Z',
              timestampedAt: '2026-11-24T10:00:05.000Z',
              certificateSha256: 'c'.repeat(64),
            },
          ];
        },
        ...overrides,
      }),
    };
  };

  /**
   * `startedAs` plays a request started under an earlier flow: `embedded` while the
   * certificate page went on the file before signing, `before` from before that.
   */
  async function completed(
    pdfOverrides: Parameters<typeof fakePdfEngine>[0] = {},
    startedAs?: 'embedded' | 'before',
    server: Partial<SignServerOptions> = {},
  ) {
    const { pdf, calls } = engine(pdfOverrides);
    const provider = fakeEsignProvider({
      sign: (bytes) => new Uint8Array([...bytes, ...new TextEncoder().encode('esp-signature\n')]),
    });
    const { h, hooks } = setup({ provider, server: { pdf, ...server } });
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    if (startedAs) {
      const list = h.store.listEvents.bind(h.store);
      h.store.listEvents = async (id) =>
        (await list(id)).map((e) => {
          if (e.action !== 'recipient.esign_started' || !e.data) return e;
          const data = { ...e.data };
          if (startedAs === 'embedded') data.certificate = 'embedded';
          else delete data.certificate;
          return { ...e, data };
        });
    }
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    const docId = envelope.documents[0]!.id;
    const download = async (version: string) => {
      const res = await h.server.app.request(
        `/v1/envelopes/${envelope.id}/documents/${docId}?version=${version}`,
        { headers: { authorization: 'Bearer test-key-0123456789abcdef' } },
      );
      return {
        status: res.status,
        text: await res.text(),
        name: res.headers.get('content-disposition') ?? '',
      };
    };
    const events = async () =>
      (await h.call('GET', `/v1/envelopes/${envelope.id}/events`)).json.events as {
        action: string;
        data?: Record<string, unknown>;
      }[];
    const receipt = async () => {
      const status = await h.call('GET', `/v1/sign/${token}/esign`);
      const headers = { 'x-sign-receipt': status.res.headers.get('x-sign-receipt')! };
      return { headers, view: (await h.call('GET', '/v1/sign/receipt', { headers })).json };
    };
    return { h, hooks, calls, envelope, token, docId, ref, download, events, receipt };
  }

  it('seals the signed file as it came and gives the certificate and audit trail apart', async () => {
    const { h, calls, envelope, docId, ref, download, events, receipt } = await completed();
    expect(calls).toEqual(['countersign']);
    const sealed = await download('sealed');
    expect(sealed.text).toMatch(/fields=2;values=2\nesp-signature\ncountersigned\n$/);
    expect(sealed.text).not.toContain('certificate');

    const certificate = await download('certificate');
    expect(certificate.status).toBe(200);
    expect(certificate.text).toContain(`certificate-and-audit-trail=${envelope.id}`);
    expect(certificate.text).toContain(
      'esign=RAVI KUMAR;issuer=Test ESP CA;signedAt=2026-11-24T10:00:05.000Z',
    );
    expect(certificate.text).toContain('sealed;reason=Test seal');
    expect(decodeURIComponent(certificate.name)).toContain(
      'Offer letter (certificate and audit trail).pdf',
    );

    const log = await events();
    expect(log.find((e) => e.action === 'recipient.esign_started')!.data).toMatchObject({
      certificate: 'separate',
    });
    const seal = log.find((e) => e.action === 'document.sealed')!;
    expect(seal.data).toMatchObject({ seal: 'countersigned', certificate: 'with_audit_trail' });
    expect(certificate.text).toContain(`signed=${String(seal.data!.sha256)}`);
    expect(log.filter((e) => e.action === 'recipient.signed').at(-1)!.data).toMatchObject({
      signerName: 'RAVI KUMAR',
      certificateIssuer: 'Test ESP CA',
      providerAuditTrail: true,
    });

    const { headers, view } = await receipt();
    expect(view.documents).toEqual([
      {
        id: docId,
        name: 'offer.pdf',
        sealed: true,
        certificate: true,
        certificateWithAuditTrail: true,
      },
    ]);
    const copy = await h.server.app.request(
      `/v1/sign/receipt/documents/${docId}?file=certificate`,
      { headers },
    );
    expect(await copy.text()).toContain(`certificate-and-audit-trail=${envelope.id}`);

    const mail = h.mailer.sent.filter((m) => m.attachments?.length).at(-1)!;
    expect(mail.attachments!.map((a) => a.filename)).toEqual([
      'offer.pdf',
      'Offer letter (certificate and audit trail).pdf',
      'Offer letter (Leegality audit trail).pdf',
    ]);
    expect(mail.text).toContain(
      'The document signed with Aadhaar eSign and its certificate and audit trail are attached.',
    );

    const theirs = await download('provider-audit-trail');
    expect(theirs.status).toBe(200);
    expect(theirs.text).toContain(`provider-audit-trail=${ref}`);
    expect(decodeURIComponent(theirs.name)).toContain('Offer letter (Leegality audit trail).pdf');
  });

  it('links the certificate and audit trail when the files cannot be attached', async () => {
    const { h } = await completed({}, undefined, { limits: { maxAttachmentBytes: 1 } });
    const mail = h.mailer.sent.filter((m) => m.meta?.kind === 'completed_copy').at(-1)!;
    expect(mail.attachments).toBeUndefined();
    expect(mail.text).toContain('Offer letter (certificate and audit trail).pdf: ');
    expect(mail.text).toContain('&file=certificate');
    expect(mail.text).not.toContain('file=audit-trail');
    expect(mail.text).not.toContain('Leegality audit trail');
  });

  it('keeps the certificate page of a request started while it went on the file', async () => {
    const { h, docId, download, events, receipt } = await completed({}, 'embedded');
    const seal = (await events()).find((e) => e.action === 'document.sealed')!.data;
    expect(seal).toMatchObject({ seal: 'countersigned' });
    expect(seal).not.toHaveProperty('certificate');
    expect((await download('certificate')).status).toBe(409);
    expect((await receipt()).view.documents).toEqual([
      {
        id: docId,
        name: 'offer.pdf',
        sealed: true,
        certificate: false,
        certificateWithAuditTrail: false,
      },
    ]);
    const mail = h.mailer.sent.filter((m) => m.attachments?.length).at(-1)!;
    expect(mail.attachments!.map((a) => a.filename)).toEqual([
      'offer.pdf',
      'Offer letter (audit trail).pdf',
      'Offer letter (Leegality audit trail).pdf',
    ]);
  });

  it('gives a request started before the certificate page went on the file the same files', async () => {
    const { envelope, download, events } = await completed({}, 'before');
    const seal = (await events()).find((e) => e.action === 'document.sealed')!.data;
    expect(seal).toMatchObject({ seal: 'countersigned', certificate: 'with_audit_trail' });
    expect((await download('certificate')).text).toContain(
      `certificate-and-audit-trail=${envelope.id}`,
    );
  });

  it('falls back to the certificate alone on an engine without the combined file', async () => {
    const { h, envelope, download, events } = await completed({
      certificateWithAuditTrailPdf: undefined,
      async certificatePdf(input) {
        return new TextEncoder().encode(`%PDF-1.7\ncertificate-of=${input.envelope.id}\n`);
      },
    });
    const seal = (await events()).find((e) => e.action === 'document.sealed')!.data;
    expect(seal).toMatchObject({ certificate: 'separate' });
    expect((await download('certificate')).text).toContain(`certificate-of=${envelope.id}`);
    const mail = h.mailer.sent.filter((m) => m.attachments?.length).at(-1)!;
    expect(mail.attachments!.map((a) => a.filename)).toEqual([
      'offer.pdf',
      'offer (signing certificate).pdf',
      'Offer letter (audit trail).pdf',
      'Offer letter (Leegality audit trail).pdf',
    ]);
  });

  it('keeps a file the provider locked exactly as it came', async () => {
    const { h, envelope, download } = await completed({
      async countersign() {
        throw new SignError('PDF_ALREADY_SIGNED', 'locked', {
          reason: 'locked',
          step: 'countersign',
        });
      },
    });
    const sealed = await download('sealed');
    expect(sealed.text).toMatch(/esp-signature\n$/);
    const events = (await h.call('GET', `/v1/envelopes/${envelope.id}/events`)).json.events as {
      action: string;
      data?: Record<string, unknown>;
    }[];
    const seal = events.find((e) => e.action === 'document.sealed')!.data;
    expect(seal).toMatchObject({ seal: 'provider_only', certificate: 'with_audit_trail' });
    expect((await download('certificate')).status).toBe(200);
  });

  it('says there is no separate certificate for an ordinary envelope', async () => {
    const h = harness();
    const created = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({
        send: true,
        recipients: [people.asha],
        fields: [signature('asha', 72)],
      }),
    });
    const envelope = created.json as Api;
    await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
      body: { consent: true, values: valuesOf(envelope, 'asha@example.com') },
    });
    const res = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${envelope.documents[0]!.id}?version=certificate`,
    );
    expect(res.status).toBe(409);
  });
});

describe('starting again, replaced recipients and the provider file', () => {
  /**
   * An envelope sent while an Aadhaar eSign signer could still fill in a field of their own,
   * so starting again with another value asks the provider again.
   */
  async function readyWithNote(h: Harness) {
    const ready = await readyForRavi(h);
    const stored = (await h.store.load(ready.envelope.id))!;
    const ravi = stored.envelope.recipients.find((r) => r.email === 'ravi@example.com')!;
    const note = {
      id: 'note',
      documentId: stored.envelope.documents[0]!.id,
      recipientId: ravi.id,
      type: 'text' as const,
      page: 1,
      rect: { x: 300, y: 500, width: 180, height: 24 },
      required: true,
    };
    await h.store.save(
      { ...stored.envelope, fields: [...stored.envelope.fields, note] },
      [],
      stored.version,
    );
    const envelope = (await h.call('GET', `/v1/envelopes/${ready.envelope.id}`)).json as Api;
    return { ...ready, envelope };
  }

  function raviValues(envelope: Api, text: string) {
    const recipient = envelope.recipients.find((r) => r.email === 'ravi@example.com')!;
    return (envelope.fields as (Api['fields'][number] & { type: string })[])
      .filter((f) => f.recipientId === recipient.id && f.type !== 'aadhaar')
      .map((f) => ({ fieldId: f.id, value: f.type === 'text' ? text : PNG }));
  }
  const startWith = (h: Harness, token: string, envelope: Api, text: string) =>
    h.call('POST', `/v1/sign/${token}/esign`, {
      body: { consent: true, values: raviValues(envelope, text) },
    });

  it('keeps what the first request reserved when the signer starts again', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token } = await readyWithNote(h);
    const first = await startWith(h, token, envelope, 'one');
    const second = await startWith(h, token, envelope, 'two');
    expect(second.status).toBe(200);
    expect(second.json.signUrl).not.toBe(first.json.signUrl);
    expect(second.json.resumed).toBeUndefined();
    expect(provider.requests).toHaveLength(2);
    expect(hooks).toEqual(['start', 'start']);

    // The first request is still good at the provider, and the signer uses it.
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hooks).toEqual(['start', 'start', 'signed']);
    const done = await statusOf(h, envelope.id);
    expect(done.status).toBe('completed');
    const status = await h.call('GET', `/v1/sign/${token}/esign`);
    expect(status.json.status).toBe('signed');

    h.advance(25 * HOUR);
    await h.server.tick();
    expect(hooks).toEqual(['start', 'start', 'signed', 'expired']);
  });

  it('gives back a replaced request only when it runs out', async () => {
    const { h, hooks } = setup();
    const { envelope, token } = await readyWithNote(h);
    await startWith(h, token, envelope, 'one');
    await startWith(h, token, envelope, 'two');
    await h.server.tick();
    expect(hooks).toEqual(['start', 'start']);
    h.advance(25 * HOUR);
    await h.server.tick();
    expect(hooks.filter((x) => x === 'expired')).toHaveLength(2);
  });

  it('goes back to the open request when a second one cannot be reserved', async () => {
    let allowed = 1;
    const { h, provider, hooks } = setup({
      esign: {
        onStart: async () => {
          if (allowed === 0) {
            throw new SignError('ESIGN_UNAVAILABLE', 'Not available right now', {
              reason: 'no_credits',
            });
          }
          allowed -= 1;
        },
      },
    });
    const { envelope, token } = await readyWithNote(h);
    const first = await startWith(h, token, envelope, 'one');
    const second = await startWith(h, token, envelope, 'two');
    expect(second.status).toBe(200);
    expect(second.json).toEqual({ ...first.json, resumed: true });
    expect(provider.requests).toHaveLength(1);
    expect(hooks).toEqual([]);
    const status = await h.call('GET', `/v1/sign/${token}/esign`);
    expect(status.json).toMatchObject({ status: 'pending', signUrl: first.json.signUrl });

    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hooks).toEqual(['signed']);
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
  });

  it('never applies the signature of a recipient who was replaced', async () => {
    const { h, provider, hooks } = setup();
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    const ravi = envelope.recipients.find((r) => r.email === 'ravi@example.com')!;
    const corrected = await h.call('PATCH', `/v1/envelopes/${envelope.id}/recipients/${ravi.id}`, {
      body: { email: 'ravi.k@example.com', name: 'Ravi K.' },
    });
    expect(corrected.status).toBe(200);
    expect(hooks).toEqual(['start', 'failed']);

    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    const body = provider.webhook(ref, 'signed');
    expect((await h.call('POST', WEBHOOK, { body })).status).toBe(200);
    await h.call('POST', WEBHOOK, { body });
    // The provider did the work, so the hook hears of it once; nothing is signed.
    expect(hooks).toEqual(['start', 'failed', 'signed']);
    const after = await statusOf(h, envelope.id);
    expect(after.status).toBe('in_progress');
    expect(after.recipients[1]!.status).not.toBe('signed');
    expect((await h.call('GET', `/v1/sign/${token}/esign`)).status).toBe(401);

    // The right person signs; the first person's link still learns nothing.
    const fresh = h.tokenFor('ravi.k@example.com');
    const again = await h.call('POST', `/v1/sign/${fresh}/esign`, {
      body: { consent: true, values: valuesOf(envelope, 'ravi@example.com') },
    });
    expect(again.status).toBe(200);
    const next = provider.requests[1]!.ref;
    provider.finish(next);
    await h.call('POST', WEBHOOK, { body: provider.webhook(next, 'signed') });
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
    const old = await h.call('GET', `/v1/sign/${token}/esign`);
    expect(old.status).toBe(401);
    expect(old.res.headers.get('x-sign-receipt')).toBeNull();
    const own = await h.call('GET', `/v1/sign/${fresh}/esign`);
    expect(own.json.status).toBe('signed');
    expect(own.res.headers.get('x-sign-receipt')).toBeTruthy();
  });

  const signatureInfo = (overrides: Record<string, unknown> = {}) => ({
    valid: true,
    coversWholeDocument: true,
    coveredBytes: 10,
    signer: { commonName: 'RAVI KUMAR' },
    issuer: { commonName: 'Test ESP CA' },
    certificateSha256: 'ab'.repeat(32),
    ...overrides,
  });

  it.each([
    ['is not signed', []],
    ['has content after its signature', [signatureInfo({ coversWholeDocument: false })]],
    ['carries a signature that does not verify', [signatureInfo({ valid: false })]],
  ])('refuses a provider file that %s', async (_name, signatures) => {
    const { h, provider, hooks } = setup({
      server: { pdf: fakePdfEngine({ verifySignatures: async () => signatures }) },
    });
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    const hook = await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hook.status).toBe(200);
    expect(hooks).toEqual(['start', 'failed']);
    const after = await statusOf(h, envelope.id);
    expect(after.status).toBe('in_progress');
    expect(after.recipients[1]!.status).not.toBe('signed');
    expect(await actions(h, envelope.id)).toContain('recipient.esign_failed');
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hooks).toEqual(['start', 'failed']);
  });

  it('accepts a signature it cannot read only when the install says so, and notes it', async () => {
    const { h, provider } = setup({
      esign: { acceptUnreadableSignatures: true },
      server: {
        pdf: fakePdfEngine({ verifySignatures: async () => [signatureInfo({ valid: false })] }),
      },
    });
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect((await statusOf(h, envelope.id)).status).toBe('completed');
    const events = (await h.call('GET', `/v1/envelopes/${envelope.id}/events`)).json.events as {
      action: string;
      data?: Record<string, unknown>;
    }[];
    expect(events.filter((e) => e.action === 'recipient.signed').at(-1)!.data).toMatchObject({
      signature: 'unverified',
    });
  });

  it('marks a signature made in the provider test environment', async () => {
    const provider = Object.assign(fakeEsignProvider(), { environment: 'sandbox' as const });
    const { h } = setup({ provider });
    const { envelope, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    const done = await statusOf(h, envelope.id);
    expect(done.recipients[1]!.esign).toMatchObject({ status: 'signed', sandbox: true });
    expect(typeof done.recipients[1]!.esign!.ref).toBe('string');
  });
});
