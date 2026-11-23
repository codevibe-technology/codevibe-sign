import { describe, expect, it } from 'vitest';
import { fakePdf } from '../testing/fake-pdf';
import { API_KEY, envelopeBody, harness, pdfBase64, PNG } from '../testing/harness';

const ACME_KEY = 'acme-key-0123456789abcdef';
const OTHER_KEY = 'other-key-0123456789abcdef';
const acme = { authorization: `Bearer ${ACME_KEY}` };
const other = { authorization: `Bearer ${OTHER_KEY}` };

function setup() {
  const h = harness({
    apiKeys: [
      API_KEY,
      { id: 'acme', key: ACME_KEY, workspaceId: 'ws_acme' },
      { id: 'other', key: OTHER_KEY, workspaceId: 'ws_other' },
    ],
  });
  const send = async (overrides: Record<string, unknown> = {}) =>
    (
      await h.call('POST', '/v1/envelopes', {
        headers: acme,
        body: envelopeBody({ send: true, ...overrides }),
      })
    ).json as {
      id: string;
      recipients: { id: string; email: string }[];
      fields: { id: string; recipientId: string; page: number }[];
      documents: { id: string }[];
    };
  const asha = (e: { recipients: { id: string }[] }) => e.recipients[0]!.id;
  const ravi = (e: { recipients: { id: string }[] }) => e.recipients[1]!.id;
  const events = async (id: string) =>
    (await h.call('GET', `/v1/envelopes/${id}/events`, { headers: acme })).json.events as {
      action: string;
      recipientId?: string;
      data?: Record<string, unknown>;
    }[];
  const signAs = async (
    token: string,
    envelope: { fields: { id: string; recipientId: string }[] },
    recipientId: string,
  ) =>
    h.call('POST', `/v1/sign/${token}/submit`, {
      body: {
        consent: true,
        values: envelope.fields
          .filter((f) => f.recipientId === recipientId)
          .map((f) => ({ fieldId: f.id, value: PNG })),
      },
    });
  return { h, send, asha, ravi, events, signAs };
}

const tokenOf = (url: string) => /\/sign\/([A-Za-z0-9_-]+)$/.exec(url)![1]!;

describe('POST /v1/envelopes/:id/recipients/:recipientId/link', () => {
  it('hands out a working link, stops the earlier ones and sends no email', async () => {
    const { h, send, asha, events } = setup();
    const envelope = await send();
    const emailed = h.tokenFor('asha@example.com');
    const mails = h.mailer.sent.length;
    const res = await h.call(
      'POST',
      `/v1/envelopes/${envelope.id}/recipients/${asha(envelope)}/link`,
      {
        headers: acme,
      },
    );
    expect(res.status).toBe(201);
    expect(res.res.headers.get('cache-control')).toBe('no-store');
    const token = tokenOf(res.json.url);
    expect(token).not.toBe(emailed);
    expect(h.mailer.sent).toHaveLength(mails);
    expect((await h.call('GET', `/v1/sign/${token}`)).status).toBe(200);
    expect((await h.call('GET', `/v1/sign/${emailed}`)).status).toBe(401);

    const shared = (await events(envelope.id)).filter((e) => e.action === 'recipient.link_shared');
    expect(shared).toEqual([
      expect.objectContaining({ recipientId: asha(envelope), data: { by: 'acme' } }),
    ]);
    expect(JSON.stringify(await events(envelope.id))).not.toContain(token);
  });

  it('only keeps the newest shared link working', async () => {
    const { h, send, asha } = setup();
    const envelope = await send();
    const path = `/v1/envelopes/${envelope.id}/recipients/${asha(envelope)}/link`;
    const first = tokenOf((await h.call('POST', path, { headers: acme })).json.url);
    const second = tokenOf((await h.call('POST', path, { headers: acme })).json.url);
    expect((await h.call('GET', `/v1/sign/${first}`)).status).toBe(401);
    expect((await h.call('GET', `/v1/sign/${second}`)).status).toBe(200);
  });

  it('allows five links per recipient per hour', async () => {
    const { h, send, asha } = setup();
    const envelope = await send();
    const path = `/v1/envelopes/${envelope.id}/recipients/${asha(envelope)}/link`;
    for (let i = 0; i < 5; i++) {
      expect((await h.call('POST', path, { headers: acme })).status).toBe(201);
    }
    const refused = await h.call('POST', path, { headers: acme });
    expect(refused.status).toBe(429);
    expect(refused.json.error.message).toMatch(/5 links were already taken/);
    h.advance(61 * 60 * 1000);
    expect((await h.call('POST', path, { headers: acme })).status).toBe(201);
  });

  it('still asks for the email code when the signer must use one', async () => {
    const { h, send } = setup();
    const envelope = await send({
      recipients: [{ key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' }],
      fields: [
        { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
      ],
    });
    const res = await h.call(
      'POST',
      `/v1/envelopes/${envelope.id}/recipients/${envelope.recipients[0]!.id}/link`,
      { headers: acme },
    );
    const view = await h.call('GET', `/v1/sign/${tokenOf(res.json.url)}`);
    expect(view.json).toMatchObject({ otpRequired: true, authenticated: false });
  });

  it('is refused for someone not yet due, someone who signed and a final envelope', async () => {
    const { h, send, asha, ravi, signAs } = setup();
    const envelope = await send();
    const link = (rid: string) =>
      h.call('POST', `/v1/envelopes/${envelope.id}/recipients/${rid}/link`, { headers: acme });
    expect((await link(ravi(envelope))).json.error.code).toBe('NOT_YOUR_TURN');
    await signAs(h.tokenFor('asha@example.com'), envelope, asha(envelope));
    expect((await link(asha(envelope))).json.error.code).toBe('INVALID_STATE');
    await h.call('POST', `/v1/envelopes/${envelope.id}/void`, {
      headers: acme,
      body: { reason: 'Wrong file' },
    });
    expect((await link(ravi(envelope))).json.error.code).toBe('INVALID_STATE');
  });

  it('is not available to another workspace and is never replayed from an Idempotency-Key', async () => {
    const { h, send, asha } = setup();
    const envelope = await send();
    const path = `/v1/envelopes/${envelope.id}/recipients/${asha(envelope)}/link`;
    expect((await h.call('POST', path, { headers: other })).status).toBe(404);
    const first = await h.call('POST', path, { headers: { ...acme, 'idempotency-key': 'k1' } });
    const retry = await h.call('POST', path, { headers: { ...acme, 'idempotency-key': 'k1' } });
    expect(retry.res.headers.get('idempotent-replayed')).toBeNull();
    expect(retry.json.url).not.toBe(first.json.url);
  });
});

describe('PATCH /v1/envelopes/:id/recipients/:recipientId', () => {
  it('moves the current signer to a new address and invites it at once', async () => {
    const { h, send, asha, events } = setup();
    const envelope = await send();
    const old = h.tokenFor('asha@example.com');
    const res = await h.call('PATCH', `/v1/envelopes/${envelope.id}/recipients/${asha(envelope)}`, {
      headers: acme,
      body: { email: 'asha.rao@example.com', name: 'Asha R.' },
    });
    expect(res.status).toBe(200);
    expect(res.json.recipients[0]).toMatchObject({
      name: 'Asha R.',
      email: 'asha.rao@example.com',
      role: 'signer',
      order: 1,
      status: 'notified',
    });
    expect(res.json.fields).toEqual(envelope.fields);
    const fresh = h.tokenFor('asha.rao@example.com');
    expect((await h.call('GET', `/v1/sign/${fresh}`)).status).toBe(200);
    expect((await h.call('GET', `/v1/sign/${old}`)).status).toBe(401);
    const corrected = (await events(envelope.id)).find((e) => e.action === 'recipient.corrected');
    expect(corrected?.data).toMatchObject({
      oldEmail: 'asha@example.com',
      newEmail: 'asha.rao@example.com',
      oldName: 'Asha Rao',
      newName: 'Asha R.',
      invited: true,
      by: 'acme',
    });
    expect(h.mailer.sent.filter((m) => m.to === 'asha@example.com')).toHaveLength(1);
  });

  it('renames without an email unless asked to send a new invitation', async () => {
    const { h, send, asha } = setup();
    const envelope = await send();
    const before = h.mailer.sent.length;
    const path = `/v1/envelopes/${envelope.id}/recipients/${asha(envelope)}`;
    await h.call('PATCH', path, { headers: acme, body: { name: 'Asha Rao Kumar' } });
    expect(h.mailer.sent).toHaveLength(before);
    await h.call('PATCH', path, { headers: acme, body: { name: 'Asha K.', resend: true } });
    expect(h.mailer.sent).toHaveLength(before + 1);
  });

  it('refuses someone who signed, a bad email and another workspace', async () => {
    const { h, send, asha, signAs } = setup();
    const envelope = await send();
    const path = `/v1/envelopes/${envelope.id}/recipients/${asha(envelope)}`;
    expect((await h.call('PATCH', path, { headers: acme, body: { email: 'nope' } })).status).toBe(
      400,
    );
    expect((await h.call('PATCH', path, { headers: other, body: { name: 'X' } })).status).toBe(404);
    await signAs(h.tokenFor('asha@example.com'), envelope, asha(envelope));
    const acted = await h.call('PATCH', path, { headers: acme, body: { name: 'X' } });
    expect(acted.status).toBe(409);
    expect(acted.json.error.details.reason).toBe('acted');
  });
});

describe('POST /v1/envelopes/:id/recall', () => {
  it('voids the envelope and returns a linked draft copy without signatures', async () => {
    const { h, send, asha, signAs, events } = setup();
    const envelope = await send();
    await signAs(h.tokenFor('asha@example.com'), envelope, asha(envelope));
    const res = await h.call('POST', `/v1/envelopes/${envelope.id}/recall`, {
      headers: acme,
      body: { note: 'Wrong joining date' },
    });
    expect(res.status).toBe(201);
    const { draft, recalled } = res.json;
    expect(recalled.status).toBe('voided');
    expect(draft).toMatchObject({ status: 'draft', title: 'Offer letter' });
    expect(draft.values).toEqual([]);
    expect(
      draft.recipients.map((r: { email: string; status: string }) => [r.email, r.status]),
    ).toEqual([
      ['asha@example.com', 'pending'],
      ['ravi@example.com', 'pending'],
      ['hr@example.com', 'pending'],
    ]);
    expect(draft.fields).toHaveLength(envelope.fields.length);
    const original = await h.files.get(
      (await h.store.load(draft.id))!.envelope.documents[0]!.fileKey,
    );
    expect(original).toEqual(fakePdf(2));

    expect((await events(envelope.id)).map((e) => [e.action, e.data]).slice(-2)).toEqual([
      ['envelope.voided', { reason: 'Recalled to correct: Wrong joining date' }],
      [
        'envelope.recalled',
        { replacementId: draft.id, replacementTitle: 'Offer letter', by: 'acme' },
      ],
    ]);
    expect((await events(draft.id))[0]).toMatchObject({
      action: 'envelope.created',
      data: { recalledFrom: envelope.id, recalledFromTitle: 'Offer letter', by: 'acme' },
    });
    expect(
      h.mailer.sent.some((m) => m.to === 'hr@example.com' && m.subject.startsWith('Cancelled')),
    ).toBe(false);
    expect(
      h.mailer.sent.some((m) => m.to === 'asha@example.com' && m.subject.startsWith('Cancelled')),
    ).toBe(true);
  });

  it('is only for sent envelopes in the caller’s workspace', async () => {
    const { h, send } = setup();
    const envelope = await send();
    expect(
      (await h.call('POST', `/v1/envelopes/${envelope.id}/recall`, { headers: other })).status,
    ).toBe(404);
    const draft = await h.call('POST', '/v1/envelopes', { headers: acme, body: envelopeBody() });
    expect(
      (await h.call('POST', `/v1/envelopes/${draft.json.id}/recall`, { headers: acme })).status,
    ).toBe(409);
  });
});

describe('POST /v1/envelopes/:id/revise', () => {
  it('copies a declined envelope to a linked draft and leaves it declined', async () => {
    const { h, send, events } = setup();
    const envelope = await send();
    await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/decline`, {
      body: { reason: 'The notice period is wrong' },
    });
    const res = await h.call('POST', `/v1/envelopes/${envelope.id}/revise`, { headers: acme });
    expect(res.status).toBe(201);
    expect(res.json.declined.status).toBe('declined');
    const draftId = res.json.draft.id as string;
    expect((await events(envelope.id)).at(-1)).toMatchObject({
      action: 'envelope.revised',
      data: { replacementId: draftId, by: 'acme' },
    });
    expect((await events(draftId))[0]?.data).toMatchObject({ revisedFrom: envelope.id });
  });

  it('refuses envelopes that are not declined, and other workspaces', async () => {
    const { h, send } = setup();
    const envelope = await send();
    expect(
      (await h.call('POST', `/v1/envelopes/${envelope.id}/revise`, { headers: acme })).status,
    ).toBe(409);
    expect(
      (await h.call('POST', `/v1/envelopes/${envelope.id}/revise`, { headers: other })).status,
    ).toBe(404);
  });

  it('carries the change note into the invitation and the signing page', async () => {
    const { h } = setup();
    const created = await h.call('POST', '/v1/envelopes', {
      headers: acme,
      body: envelopeBody({ changeNote: 'The notice period is now 30 days.' }),
    });
    await h.call('POST', `/v1/envelopes/${created.json.id}/send`, { headers: acme });
    const invite = h.mailer.sent.find((m) => m.to === 'asha@example.com')!;
    expect(invite.text).toContain('What changed: The notice period is now 30 days.');
    expect(invite.html).toContain('What changed: The notice period is now 30 days.');
    const view = await h.call('GET', `/v1/sign/${h.tokenFor('asha@example.com')}`);
    expect(view.json.envelope.changeNote).toBe('The notice period is now 30 days.');
  });
});

describe('PUT /v1/envelopes/:id/documents/:docId', () => {
  it('replaces a draft’s PDF, keeping fields that fit and naming the ones moved', async () => {
    const { h } = setup();
    const created = (await h.call('POST', '/v1/envelopes', { headers: acme, body: envelopeBody() }))
      .json;
    const docId = created.documents[0].id;
    const same = await h.call('PUT', `/v1/envelopes/${created.id}/documents/${docId}`, {
      headers: acme,
      body: { name: 'offer-v2.pdf', content: pdfBase64(2) },
    });
    expect(same.status).toBe(200);
    expect(same.json.movedFields).toEqual([]);
    expect(same.json.envelope.documents[0].name).toBe('offer-v2.pdf');

    const shorter = await h.call('PUT', `/v1/envelopes/${created.id}/documents/${docId}`, {
      headers: acme,
      body: { content: pdfBase64(1) },
    });
    const onSecondPage = created.fields
      .filter((f: { page: number }) => f.page === 1)
      .map((f: { id: string }) => f.id);
    expect(shorter.json.movedFields.sort()).toEqual(onSecondPage.sort());
    expect(shorter.json.envelope.fields.every((f: { page: number }) => f.page === 0)).toBe(true);
    const stored = await h.files.get(
      (await h.store.load(shorter.json.envelope.id))!.envelope.documents[0]!.fileKey,
    );
    expect(stored).toEqual(fakePdf(1));
  });

  it('refuses sent envelopes, other workspaces and files that are not PDFs', async () => {
    const { h, send } = setup();
    const envelope = await send();
    const path = `/v1/envelopes/${envelope.id}/documents/${envelope.documents[0]!.id}`;
    expect(
      (await h.call('PUT', path, { headers: acme, body: { content: pdfBase64(2) } })).status,
    ).toBe(409);
    expect(
      (await h.call('PUT', path, { headers: other, body: { content: pdfBase64(2) } })).status,
    ).toBe(404);
    const draft = (await h.call('POST', '/v1/envelopes', { headers: acme, body: envelopeBody() }))
      .json;
    const bad = await h.call(
      'PUT',
      `/v1/envelopes/${draft.id}/documents/${draft.documents[0].id}`,
      {
        headers: acme,
        body: { content: Buffer.from('not a pdf').toString('base64') },
      },
    );
    expect(bad.status).toBe(422);
  });
});

describe('storage paths', () => {
  it('never appear in an answer that carries an envelope', async () => {
    const { h, send } = setup();
    const bodies: unknown[] = [];
    const call = async (method: string, path: string, body?: unknown) => {
      const result = await h.call(method, path, { headers: acme, ...(body ? { body } : {}) });
      expect(result.status).toBeLessThan(300);
      bodies.push(result.json);
      return result.json;
    };

    const draft = await call('POST', '/v1/envelopes', envelopeBody());
    await call('PATCH', `/v1/envelopes/${draft.id}`, { title: 'Offer letter v2' });
    await call('PUT', `/v1/envelopes/${draft.id}/documents/${draft.documents[0].id}`, {
      content: pdfBase64(2),
    });
    await call('POST', `/v1/envelopes/${draft.id}/send`);
    h.advance(16 * 60_000);
    await call('POST', `/v1/envelopes/${draft.id}/remind`);
    await call('GET', `/v1/envelopes/${draft.id}`);
    await call('GET', '/v1/envelopes');
    await call('POST', `/v1/envelopes/${draft.id}/recall`, { note: 'Wrong date' });
    const second = await send();
    await call('POST', `/v1/envelopes/${second.id}/void`, { reason: 'No longer needed' });

    expect(bodies).toHaveLength(9);
    expect(JSON.stringify(bodies)).not.toMatch(/fileKey|original\.pdf|envelopes\/[^"]+\.pdf/);
    expect(JSON.stringify(h.deliveries.map((d) => d.body))).not.toContain('fileKey');
  });
});
