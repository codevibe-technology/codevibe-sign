import { describe, expect, it } from 'vitest';
import { createSignClient, createSignerClient, SignApiError, type CreateEnvelopeInput } from '.';
import { API_KEY, BASE_URL, PNG, fakePdf, testServer } from './test/server';

const decoder = new TextDecoder();

function offer(overrides: Partial<CreateEnvelopeInput> = {}): CreateEnvelopeInput {
  return {
    title: 'Offer letter',
    documents: [{ key: 'offer', name: 'offer.pdf', content: fakePdf(2) }],
    recipients: [
      { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
      { key: 'hr', name: 'HR', email: 'hr@example.com', role: 'viewer' },
    ],
    fields: [
      { recipient: 'asha', type: 'signature', page: 1, x: 72, y: 600, width: 180, height: 48 },
    ],
    metadata: { employeeId: 'E-104' },
    ...overrides,
  };
}

function setup() {
  const env = testServer();
  const client = createSignClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: env.fetch });
  const signerFor = (email: string) =>
    createSignerClient({ baseUrl: BASE_URL, token: env.tokenFor(email), fetch: env.fetch });
  return { env, client, signerFor };
}

describe('sender and signer clients against the server', () => {
  it('runs create, send, OTP, submit and download of the sealed file', async () => {
    const { env, client, signerFor } = setup();

    const draft = await client.envelopes.create(offer());
    expect(draft.status).toBe('draft');
    expect(draft.metadata).toEqual({ employeeId: 'E-104' });
    expect(draft.documents[0]?.name).toBe('offer.pdf');

    const sent = await client.envelopes.send(draft.id);
    expect(sent.status).toBe('sent');

    const signer = signerFor('asha@example.com');
    const session = await signer.session();
    expect(session).toMatchObject({ otpRequired: true, authenticated: false, canAct: true });
    expect(session.fields).toEqual([]);
    expect(session.documents).toEqual([]);

    await expect(signer.document(draft.documents[0]!.id)).rejects.toMatchObject({
      code: 'OTP_INVALID',
      status: 401,
    });

    const otp = await signer.requestOtp();
    expect(otp.sentTo).toMatch(/@example\.com$/);
    const code = env.otp.sent.at(-1)!.code;
    const verified = await signer.verifyOtp(code);
    expect(signer.sessionToken).toBe(verified.sessionToken);
    const unlocked = await signer.session();
    expect(unlocked.authenticated).toBe(true);
    expect(unlocked.fields).toHaveLength(1);

    const original = await signer.document(draft.documents[0]!.id);
    expect(decoder.decode(original)).toContain('%PDF-1.7');
    expect(await signer.view()).toEqual({ envelopeStatus: 'sent', recipientStatus: 'viewed' });

    const done = await signer.submit([{ fieldId: unlocked.fields[0]!.id, value: PNG }]);
    expect(done).toEqual({ envelopeStatus: 'completed', recipientStatus: 'signed' });

    const sealed = await client.envelopes.downloadDocument(draft.id, draft.documents[0]!.id, {
      version: 'sealed',
    });
    expect(decoder.decode(sealed)).toMatch(/certificate\nsealed\n$/);
    const plain = await client.envelopes.downloadDocument(draft.id, draft.documents[0]!.id, {
      version: 'original',
    });
    expect(decoder.decode(plain)).not.toContain('sealed');

    const { events, chainValid } = await client.envelopes.events(draft.id);
    expect(chainValid).toBe(true);
    expect(events.map((e) => e.action)).toContain('envelope.completed');

    const certificate = await client.envelopes.certificate(draft.id);
    expect(certificate.status).toBe('completed');
    expect(certificate.documents[0]?.sealedSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uploads Blob and ArrayBuffer documents and sends on create', async () => {
    const { client } = setup();
    const envelope = await client.envelopes.create(
      offer({
        send: true,
        documents: [
          { key: 'a', name: 'a.pdf', content: new Blob([fakePdf(1)]) },
          { key: 'b', name: 'b.pdf', content: fakePdf(3).buffer as ArrayBuffer },
        ],
        fields: [
          { recipient: 'asha', document: 'b', page: 2, x: 10, y: 10, width: 100, height: 30 },
        ],
      }),
    );
    expect(envelope.status).toBe('sent');
    expect(envelope.documents.map((d) => d.pageCount)).toEqual([1, 3]);
    expect(envelope.fields[0]?.documentId).toBe(envelope.documents[1]?.id);
  });

  it('updates a draft, turns expiry dates into ISO strings and voids', async () => {
    const { client } = setup();
    const draft = await client.envelopes.create(offer());
    const expiresAt = new Date(Date.now() + 5 * 86_400_000);
    const updated = await client.envelopes.update(draft.id, {
      title: 'Offer letter v2',
      message: 'Please sign by Friday',
      expiresAt,
    });
    expect(updated).toMatchObject({ title: 'Offer letter v2', message: 'Please sign by Friday' });
    expect(updated.expiresAt).toBe(expiresAt.toISOString());

    const cleared = await client.envelopes.update(draft.id, { message: null });
    expect(cleared.message).toBeUndefined();

    await client.envelopes.send(draft.id);
    const voided = await client.envelopes.void(draft.id, 'Sent by mistake');
    expect(voided.status).toBe('voided');
  });

  it('declines through the signer client', async () => {
    const { client, signerFor } = setup();
    const envelope = await client.envelopes.create(
      offer({ recipients: [{ key: 'asha', name: 'Asha', email: 'asha@example.com' }], send: true }),
    );
    const signer = signerFor('asha@example.com');
    const result = await signer.decline('Wrong salary');
    expect(result).toEqual({ envelopeStatus: 'declined', recipientStatus: 'declined' });
    expect((await client.envelopes.get(envelope.id)).status).toBe('declined');
    await expect(signer.session()).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('keeps a session passed in from an earlier visit', async () => {
    const { env, client } = setup();
    await client.envelopes.create(offer({ send: true }));
    const token = env.tokenFor('asha@example.com');
    const first = createSignerClient({ baseUrl: BASE_URL, token, fetch: env.fetch });
    await first.requestOtp();
    const { sessionToken } = await first.verifyOtp(env.otp.sent.at(-1)!.code);

    const again = createSignerClient({ baseUrl: BASE_URL, token, sessionToken, fetch: env.fetch });
    expect((await again.session()).authenticated).toBe(true);
    const last = env.requests.at(-1)!;
    expect(last.headers.get('x-sign-session')).toBe(sessionToken);
  });
});

describe('errors from the server', () => {
  it('maps the error body to SignApiError with code, status and details', async () => {
    const { client } = setup();
    const err = await client.envelopes
      .create(offer({ recipients: [{ name: 'No email', auth: 'email_link' }] }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignApiError);
    expect(err).toMatchObject({ code: 'VALIDATION', status: 400 });
    expect((err as SignApiError).issues).toEqual([
      { path: 'recipients[0].email', message: expect.any(String) },
    ]);
  });

  it('reports a wrong API key as UNAUTHORIZED', async () => {
    const { env } = setup();
    const client = createSignClient({ baseUrl: BASE_URL, apiKey: 'wrong', fetch: env.fetch });
    await expect(client.envelopes.get('x')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
  });

  it('reports unknown envelopes, wrong states and missing seals', async () => {
    const { client } = setup();
    await expect(client.envelopes.get('missing')).rejects.toMatchObject({
      code: 'ENVELOPE_NOT_FOUND',
      status: 404,
    });
    const sent = await client.envelopes.create(offer({ send: true }));
    await expect(client.envelopes.update(sent.id, { title: 'Late' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
    await expect(
      client.envelopes.downloadDocument(sent.id, sent.documents[0]!.id, { version: 'sealed' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects a wrong one-time code without storing a session', async () => {
    const { client, signerFor } = setup();
    await client.envelopes.create(offer({ send: true }));
    const signer = signerFor('asha@example.com');
    await signer.requestOtp();
    await expect(signer.verifyOtp('000000')).rejects.toMatchObject({ code: 'OTP_INVALID' });
    expect(signer.sessionToken).toBeUndefined();
  });

  it('reads the request id header when one is set', async () => {
    const { env } = setup();
    const fetchWithId = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await env.fetch(input, init);
      const headers = new Headers(res.headers);
      headers.set('x-request-id', 'req-42');
      return new Response(res.body, { status: res.status, headers });
    }) as typeof fetch;
    const client = createSignClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: fetchWithId });
    await expect(client.envelopes.get('missing')).rejects.toMatchObject({ requestId: 'req-42' });
  });
});

describe('idempotency', () => {
  it('sends a generated Idempotency-Key on every POST and none on GET or PATCH', async () => {
    const { env, client } = setup();
    const draft = await client.envelopes.create(offer());
    await client.envelopes.update(draft.id, { title: 'v2' });
    await client.envelopes.get(draft.id);
    await client.envelopes.send(draft.id);
    const keys = env.requests.map((r) => [r.method, r.headers.get('idempotency-key')]);
    expect(keys[0]?.[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[1]).toEqual(['PATCH', null]);
    expect(keys[2]).toEqual(['GET', null]);
    expect(keys[3]?.[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[3]?.[1]).not.toBe(keys[0]?.[1]);
  });

  it('replays create when the same key is used again', async () => {
    const { client } = setup();
    const input = offer();
    const first = await client.envelopes.create(input, { idempotencyKey: 'hire-E-104' });
    const second = await client.envelopes.create(input, { idempotencyKey: 'hire-E-104' });
    expect(second.id).toBe(first.id);
  });

  it('rejects a key reused for a different request', async () => {
    const { client } = setup();
    await client.envelopes.create(offer(), { idempotencyKey: 'k1' });
    await expect(
      client.envelopes.create(offer({ title: 'Other' }), { idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('retries a create that failed after reaching the server without creating twice', async () => {
    const { env } = setup();
    let calls = 0;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const res = await env.fetch(input, init);
      if (calls === 1) throw new TypeError('connection reset');
      return res;
    }) as typeof fetch;
    const client = createSignClient({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: flaky,
      retryDelayMs: 1,
    });
    const created = await client.envelopes.create(offer());
    expect(calls).toBe(2);
    const keys = env.requests.map((r) => r.headers.get('idempotency-key'));
    expect(keys[0]).toBe(keys[1]);
    expect(await client.envelopes.get(created.id)).toMatchObject({ id: created.id });
  });
});

describe('fixing an envelope after sending', () => {
  it('shares a link, corrects a recipient, recalls and revises', async () => {
    const { env, client } = setup();
    const sent = await client.envelopes.create({ ...offer(), send: true });
    const asha = sent.recipients[0]!.id;
    const shared = await client.envelopes.shareLink(sent.id, asha);
    expect(shared.url).toMatch(/\/sign\/[\w-]{43}$/);
    const retried = await client.envelopes.shareLink(sent.id, asha, { idempotencyKey: 'same' });
    expect(retried.url).not.toBe(shared.url);

    const corrected = await client.envelopes.correctRecipient(sent.id, asha, { name: 'Asha R.' });
    expect(corrected.recipients[0]!.name).toBe('Asha R.');

    const { draft, recalled } = await client.envelopes.recall(sent.id, 'Wrong date');
    expect(recalled.status).toBe('voided');
    expect(draft.status).toBe('draft');

    const other = await client.envelopes.create({
      ...offer({
        recipients: [{ key: 'asha', name: 'Asha Rao', email: 'asha@example.com' }],
      }),
      send: true,
    });
    await createSignerClient({
      baseUrl: BASE_URL,
      token: env.tokenFor('asha@example.com'),
      fetch: env.fetch,
    }).decline('Not me');
    const revised = await client.envelopes.revise(other.id);
    expect(revised.declined.status).toBe('declined');
    expect(revised.draft.status).toBe('draft');
    await expect(client.envelopes.revise(draft.id)).rejects.toBeInstanceOf(SignApiError);
  });
});
