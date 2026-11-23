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
const signature = (recipient: string, x: number) => ({
  recipient,
  type: 'signature',
  page: 1,
  x,
  y: 600,
  width: 180,
  height: 48,
});

/** Asha signs by email link, then Ravi with Aadhaar eSign. */
const aadhaarBody = (overrides: Record<string, unknown> = {}) =>
  envelopeBody({
    send: true,
    recipients: [people.asha, people.ravi],
    fields: [signature('asha', 72), signature('ravi', 300)],
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
  fields: { id: string; recipientId: string }[];
  documents: { id: string }[];
}

function valuesOf(envelope: Api, email: string) {
  const recipient = envelope.recipients.find((r) => r.email === email)!;
  return envelope.fields
    .filter((f) => f.recipientId === recipient.id)
    .map((f) => ({ fieldId: f.id, value: PNG }));
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
      body: aadhaarBody({ recipients: [people.ravi], fields: [signature('ravi', 300)] }),
    });
    expect(status).toBe(201);
  });
});

describe('POST /v1/sign/:token/esign', () => {
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
    expect(new TextDecoder().decode(request.documentBytes)).toContain('fields=2;values=2');
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

  it('needs consent, the required fields and the right recipient', async () => {
    const { h, provider } = setup();
    const { envelope, token } = await readyForRavi(h);
    const values = valuesOf(envelope, 'ravi@example.com');
    const noConsent = await h.call('POST', `/v1/sign/${token}/esign`, { body: { values } });
    expect(noConsent.status).toBe(400);
    const empty = await h.call('POST', `/v1/sign/${token}/esign`, {
      body: { consent: true, values: [] },
    });
    expect(empty.json.error.code).toBe('REQUIRED_FIELDS_MISSING');
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
        async certificatePdf(input) {
          calls.push('certificate');
          return new TextEncoder().encode(`%PDF-1.7\ncertificate-of=${input.envelope.id}\n`);
        },
        async verifySignatures() {
          return [
            {
              valid: true,
              coversWholeDocument: true,
              signer: { commonName: 'RAVI KUMAR' },
              issuer: { commonName: 'Test ESP CA' },
              certificateSha256: 'c'.repeat(64),
            },
          ];
        },
        ...overrides,
      }),
    };
  };

  async function completed(pdfOverrides: Parameters<typeof fakePdfEngine>[0] = {}) {
    const { pdf, calls } = engine(pdfOverrides);
    const provider = fakeEsignProvider({
      sign: (bytes) => new Uint8Array([...bytes, ...new TextEncoder().encode('esp-signature\n')]),
    });
    const { h, hooks } = setup({ provider, server: { pdf } });
    const { envelope, token, start } = await readyForRavi(h);
    await start();
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    const docId = envelope.documents[0]!.id;
    const download = async (version: string) => {
      const res = await h.server.app.request(
        `/v1/envelopes/${envelope.id}/documents/${docId}?version=${version}`,
        { headers: { authorization: 'Bearer test-key-0123456789abcdef' } },
      );
      return { status: res.status, text: await res.text() };
    };
    return { h, hooks, calls, envelope, token, docId, download };
  }

  it('seals over the provider file without redrawing it and keeps the certificate apart', async () => {
    const { h, calls, envelope, token, docId, download } = await completed();
    expect(calls).toEqual(['countersign', 'certificate']);
    const sealed = await download('sealed');
    expect(sealed.text).toMatch(/fields=2;values=2\nesp-signature\ncountersigned\n$/);
    expect(sealed.text).not.toContain('certificate=');
    const certificate = await download('certificate');
    expect(certificate.status).toBe(200);
    expect(certificate.text).toContain(`certificate-of=${envelope.id}`);
    expect(certificate.text).toContain('sealed;reason=Test seal');

    const events = (await h.call('GET', `/v1/envelopes/${envelope.id}/events`)).json.events as {
      action: string;
      data?: Record<string, unknown>;
    }[];
    const seal = events.find((e) => e.action === 'document.sealed')!;
    expect(seal.data).toMatchObject({ seal: 'countersigned', certificate: 'separate' });
    const signed = events.filter((e) => e.action === 'recipient.signed').at(-1)!;
    expect(signed.data).toMatchObject({ certificateSha256: 'c'.repeat(64) });

    const status = await h.call('GET', `/v1/sign/${token}/esign`);
    const headers = { 'x-sign-receipt': status.res.headers.get('x-sign-receipt')! };
    const receipt = await h.call('GET', '/v1/sign/receipt', { headers });
    expect(receipt.json.documents).toEqual([
      { id: docId, name: 'offer.pdf', sealed: true, certificate: true },
    ]);
    const copy = await h.server.app.request(
      `/v1/sign/receipt/documents/${docId}?file=certificate`,
      { headers },
    );
    expect(await copy.text()).toContain(`certificate-of=${envelope.id}`);

    const mail = h.mailer.sent.filter((m) => m.attachments?.length).at(-1)!;
    expect(mail.attachments!.map((a) => a.filename)).toEqual([
      'offer.pdf',
      'offer (signing certificate).pdf',
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
    expect(events.find((e) => e.action === 'document.sealed')!.data).toMatchObject({
      seal: 'provider_only',
      certificate: 'separate',
    });
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
