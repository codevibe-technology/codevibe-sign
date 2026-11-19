import { describe, expect, it } from 'vitest';
import { API_KEY, envelopeBody, harness } from '../testing/harness';
import { fakePdf, fakePdfEngine } from '../testing/fake-pdf';

describe('sender authentication', () => {
  it('rejects requests without a key', async () => {
    const h = harness();
    const { status, json } = await h.call('GET', '/v1/envelopes/x', { auth: false });
    expect(status).toBe(401);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong key and a malformed header', async () => {
    const h = harness();
    for (const authorization of [`Bearer ${API_KEY}x`, API_KEY, 'Bearer ']) {
      const { status } = await h.call('GET', '/v1/envelopes/x', { headers: { authorization } });
      expect(status).toBe(401);
    }
  });

  it('accepts the key in any case of the scheme', async () => {
    const h = harness();
    const { status } = await h.call('GET', '/v1/envelopes/missing', {
      headers: { authorization: `bearer ${API_KEY}` },
    });
    expect(status).toBe(404);
  });

  it('leaves /health open', async () => {
    const h = harness();
    const res = await h.server.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('POST /v1/envelopes', () => {
  it('creates a draft with documents, recipients and fields', async () => {
    const h = harness();
    const { status, json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody() });
    expect(status).toBe(201);
    expect(json.status).toBe('draft');
    expect(json.documents).toHaveLength(1);
    expect(json.documents[0]).toMatchObject({ name: 'offer.pdf', pageCount: 2 });
    expect(json.documents[0].pageSizes).toHaveLength(2);
    expect(json.recipients.map((r: { name: string }) => r.name)).toEqual([
      'Asha Rao',
      'Ravi Kumar',
      'HR Team',
    ]);
    const asha = json.recipients[0].id;
    expect(json.fields[0]).toMatchObject({ recipientId: asha, page: 1, required: true });
    expect(json.auditHead).toMatch(/^[0-9a-f]{64}$/);
    expect(await h.files.get(json.documents[0].fileKey)).toEqual(fakePdf(2));
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('creates and sends in one call', async () => {
    const h = harness();
    const { json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    expect(json.status).toBe('sent');
    expect(h.mailer.sent.map((m) => m.to)).toEqual(['asha@example.com']);
    expect(h.mailer.sent[0]?.text).toContain('https://sign.example.com/sign/');
  });

  it('accepts multipart uploads', async () => {
    const h = harness();
    const form = new FormData();
    form.set('envelope', JSON.stringify({ ...envelopeBody(), documents: [{ key: 'offer' }] }));
    form.append('documents', new File([fakePdf(2)], 'offer.pdf', { type: 'application/pdf' }));
    const { status, json } = await h.call('POST', '/v1/envelopes', { body: form });
    expect(status).toBe(201);
    expect(json.documents[0].name).toBe('offer.pdf');
  });

  it('points validation errors at the field to fix', async () => {
    const h = harness();
    const body = envelopeBody();
    (body.recipients[1] as Record<string, unknown>).email = 'not-an-email';
    const { status, json } = await h.call('POST', '/v1/envelopes', { body });
    expect(status).toBe(400);
    expect(json.error.code).toBe('VALIDATION');
    expect(json.error.details.issues[0].path).toBe('recipients[1].email');
  });

  it('passes core bounds checks through with the request path', async () => {
    const h = harness();
    const body = envelopeBody();
    body.fields[0] = {
      recipient: 'asha',
      type: 'signature',
      page: 1,
      x: 600,
      y: 10,
      width: 100,
      height: 10,
    };
    const { status, json } = await h.call('POST', '/v1/envelopes', { body });
    expect(status).toBe(400);
    expect(json.error.details.issues[0].path).toMatch(/^fields\[0\]/);
  });

  it('rejects files that are not PDFs and files that are too large', async () => {
    const h = harness({ limits: { maxPdfBytes: 64 } });
    const notPdf = envelopeBody({
      documents: [{ name: 'a.pdf', content: Buffer.from('hello').toString('base64') }],
    });
    const r1 = await h.call('POST', '/v1/envelopes', { body: notPdf });
    expect(r1.status).toBe(422);
    expect(r1.json.error.code).toBe('DOCUMENT_INVALID');

    const big = Buffer.concat([Buffer.from(fakePdf(1)), Buffer.alloc(100)]).toString('base64');
    const r2 = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({ documents: [{ name: 'a.pdf', content: big }] }),
    });
    expect(r2.status).toBe(413);
    expect(r2.json.error.code).toBe('DOCUMENT_TOO_LARGE');
  });

  it('rejects malformed JSON', async () => {
    const h = harness();
    const { status, json } = await h.call('POST', '/v1/envelopes', {
      body: '{"title":',
      headers: { 'content-type': 'application/json' },
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('refuses to send an envelope a signer has no signature field in', async () => {
    const h = harness();
    const body = envelopeBody({ send: true });
    body.fields = body.fields.filter((f) => f.recipient !== 'ravi');
    const { status, json } = await h.call('POST', '/v1/envelopes', { body });
    expect(status).toBe(400);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('limits envelopes per key per minute', async () => {
    const h = harness({ limits: { envelopesPerMinute: 2 } });
    for (let i = 0; i < 2; i++) {
      expect((await h.call('POST', '/v1/envelopes', { body: envelopeBody() })).status).toBe(201);
    }
    const limited = await h.call('POST', '/v1/envelopes', { body: envelopeBody() });
    expect(limited.status).toBe(429);
    expect(limited.res.headers.get('retry-after')).toBe('60');
    h.advance(60_000);
    expect((await h.call('POST', '/v1/envelopes', { body: envelopeBody() })).status).toBe(201);
  });
});

describe('idempotency', () => {
  it('replays the first response for the same key and body', async () => {
    const h = harness();
    const headers = { 'idempotency-key': 'create-1' };
    const first = await h.call('POST', '/v1/envelopes', { body: envelopeBody(), headers });
    const second = await h.call('POST', '/v1/envelopes', { body: envelopeBody(), headers });
    expect(second.status).toBe(201);
    expect(second.json.id).toBe(first.json.id);
    expect(second.res.headers.get('idempotent-replayed')).toBe('true');
  });

  it('rejects the same key with a different body', async () => {
    const h = harness();
    const headers = { 'idempotency-key': 'create-1' };
    await h.call('POST', '/v1/envelopes', { body: envelopeBody(), headers });
    const other = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({ title: 'Other' }),
      headers,
    });
    expect(other.status).toBe(400);
    expect(other.json.error.message).toMatch(/different request/);
  });

  it('replays errors too, so a retried send does not run twice', async () => {
    const h = harness();
    const { json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody() });
    const headers = { 'idempotency-key': 'send-1' };
    const first = await h.call('POST', `/v1/envelopes/${json.id}/send`, { headers });
    const again = await h.call('POST', `/v1/envelopes/${json.id}/send`, { headers });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(h.mailer.sent).toHaveLength(1);
    const fresh = await h.call('POST', `/v1/envelopes/${json.id}/send`, {
      headers: { 'idempotency-key': 'send-2' },
    });
    expect(fresh.status).toBe(409);
  });

  it('keeps keys of different API keys apart', async () => {
    const other = 'second-key-0123456789abcdef';
    const h = harness({ apiKeys: [API_KEY, other] });
    const headers = { 'idempotency-key': 'same' };
    const a = await h.call('POST', '/v1/envelopes', { body: envelopeBody(), headers });
    const b = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody(),
      headers: { ...headers, authorization: `Bearer ${other}` },
    });
    expect(b.json.id).not.toBe(a.json.id);
  });
});

describe('draft changes, send and void', () => {
  async function draft() {
    const h = harness();
    const { json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody() });
    return { h, envelope: json };
  }

  it('updates settings, recipients and fields of a draft', async () => {
    const { h, envelope } = await draft();
    const asha = envelope.recipients[0];
    const { status, json } = await h.call('PATCH', `/v1/envelopes/${envelope.id}`, {
      body: {
        title: 'Offer letter v2',
        message: 'Please sign by Friday',
        recipients: [{ id: asha.id, name: 'Asha R.', email: 'asha@example.com' }],
        fields: [
          { recipient: asha.id, type: 'signature', page: 0, x: 10, y: 10, width: 100, height: 30 },
        ],
      },
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ title: 'Offer letter v2', message: 'Please sign by Friday' });
    expect(json.recipients).toHaveLength(1);
    expect(json.recipients[0]).toMatchObject({ id: asha.id, name: 'Asha R.' });
    expect(json.fields).toHaveLength(1);
    const stored = await h.call('GET', `/v1/envelopes/${envelope.id}`);
    expect(stored.json.title).toBe('Offer letter v2');
  });

  it('only changes drafts', async () => {
    const { h, envelope } = await draft();
    await h.call('POST', `/v1/envelopes/${envelope.id}/send`);
    const { status, json } = await h.call('PATCH', `/v1/envelopes/${envelope.id}`, {
      body: { title: 'Late' },
    });
    expect(status).toBe(409);
    expect(json.error.code).toBe('INVALID_STATE');
  });

  it('voids a sent envelope and needs a reason', async () => {
    const { h, envelope } = await draft();
    await h.call('POST', `/v1/envelopes/${envelope.id}/send`);
    const missing = await h.call('POST', `/v1/envelopes/${envelope.id}/void`, { body: {} });
    expect(missing.status).toBe(400);
    const { status, json } = await h.call('POST', `/v1/envelopes/${envelope.id}/void`, {
      body: { reason: 'Wrong salary' },
    });
    expect(status).toBe(200);
    expect(json.status).toBe('voided');
    expect(h.mailer.sent.at(-1)?.subject).toMatch(/^Cancelled/);
  });

  it('returns 404 for unknown envelopes', async () => {
    const { h } = await draft();
    const { status, json } = await h.call('GET', '/v1/envelopes/nope');
    expect(status).toBe(404);
    expect(json.error.code).toBe('ENVELOPE_NOT_FOUND');
  });

  it('lists events with a valid chain', async () => {
    const { h, envelope } = await draft();
    await h.call('POST', `/v1/envelopes/${envelope.id}/send`);
    const { json } = await h.call('GET', `/v1/envelopes/${envelope.id}/events`);
    expect(json.chainValid).toBe(true);
    expect(json.events.map((e: { action: string }) => e.action)).toEqual([
      'envelope.created',
      'envelope.sent',
      'recipient.notified',
    ]);
  });

  it('serves the original document and refuses a sealed copy before completion', async () => {
    const { h, envelope } = await draft();
    const doc = envelope.documents[0].id;
    const original = await h.server.app.request(`/v1/envelopes/${envelope.id}/documents/${doc}`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(original.status).toBe(200);
    expect(original.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(fakePdf(2));
    const sealed = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${doc}?version=sealed`,
    );
    expect(sealed.status).toBe(409);
  });
});

describe('error handling', () => {
  it('treats a PDF parser crash as an invalid document', async () => {
    const h = harness({
      pdf: {
        ...fakePdfEngine(),
        inspectPdf: async () => {
          throw new TypeError('Cannot read properties of undefined');
        },
      },
    });
    const { status, json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody() });
    expect(status).toBe(422);
    expect(json.error.code).toBe('DOCUMENT_INVALID');
  });

  it('hides unexpected errors behind INTERNAL', async () => {
    const h = harness({
      files: {
        put: async () => {
          throw new Error('disk on fire at /secret/path');
        },
        get: async () => null,
        delete: async () => {},
      },
    });
    const { status, json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody() });
    expect(status).toBe(500);
    expect(json).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(JSON.stringify(json)).not.toContain('secret');
    expect(h.logs[0]?.level).toBe('error');
  });

  it('answers unknown routes with JSON', async () => {
    const h = harness();
    const { status, json } = await h.call('GET', '/nope');
    expect(status).toBe(404);
    expect(json.error.code).toBe('NOT_FOUND');
  });
});
