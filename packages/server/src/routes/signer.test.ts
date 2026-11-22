import { describe, expect, it } from 'vitest';
import { memoryRateLimiter } from '../http/rate-limit';
import type { SignServerOptions } from '../options';
import { memoryStore } from '../store/memory';
import { envelopeBody, harness, PNG } from '../testing/harness';

async function sent(
  overrides: Record<string, unknown> = {},
  options: Partial<SignServerOptions> = {},
) {
  const h = harness(options);
  const { json } = await h.call('POST', '/v1/envelopes', {
    body: envelopeBody({ send: true, ...overrides }),
  });
  return { h, envelope: json };
}

function fieldOf(
  envelope: { fields: { id: string; recipientId: string; type: string }[] },
  recipientId: string,
  type = 'signature',
) {
  const field = envelope.fields.find((f) => f.recipientId === recipientId && f.type === type);
  if (!field) throw new Error('field not found');
  return field.id;
}

describe('GET /v1/sign/:token', () => {
  it('shows the signer their own fields and nothing about the others', async () => {
    const { h, envelope } = await sent();
    const token = h.tokenFor('asha@example.com');
    const { status, json } = await h.call('GET', `/v1/sign/${token}`);
    expect(status).toBe(200);
    expect(json.recipient).toMatchObject({ name: 'Asha Rao', status: 'notified' });
    expect(json.fields).toHaveLength(1);
    expect(json.fields[0].recipientId).toBe(envelope.recipients[0].id);
    expect(json.canAct).toBe(true);
    expect(json.otpRequired).toBe(false);
    const text = JSON.stringify(json);
    expect(text).not.toContain('ravi@example.com');
    expect(text).not.toContain('Ravi Kumar');
    expect(text).not.toContain('hr@example.com');
  });

  it('rejects unknown tokens', async () => {
    const { h } = await sent();
    const { status, json } = await h.call('GET', '/v1/sign/not-a-real-token');
    expect(status).toBe(401);
    expect(json.error.code).toBe('TOKEN_INVALID');
  });

  it('refuses malformed tokens before hashing, token rate limits or the store', async () => {
    const keys: string[] = [];
    const counting = memoryRateLimiter();
    let lookups = 0;
    const store = memoryStore();
    const findToken = store.findToken.bind(store);
    store.findToken = (hash) => {
      lookups += 1;
      return findToken(hash);
    };
    const { h } = await sent(
      {},
      {
        store,
        rateLimiter: {
          hit: (key, limit, windowMs, now) => {
            keys.push(key);
            return counting.hit(key, limit, windowMs, now);
          },
        },
      },
    );
    keys.length = 0;
    lookups = 0;
    const valid = h.tokenFor('asha@example.com');
    for (const token of ['x'.repeat(5000), `${valid}A`, valid.slice(1), `${valid.slice(1)}=`]) {
      for (const path of [`/v1/sign/${token}`, `/v1/sign/${token}/otp/verify`]) {
        const method = path.endsWith('verify') ? 'POST' : 'GET';
        const res = await h.call(method, path, {
          body: method === 'POST' ? { code: '1' } : undefined,
        });
        expect(res.status).toBe(401);
        expect(res.json.error.code).toBe('TOKEN_INVALID');
      }
    }
    expect(keys.every((key) => key.startsWith('ip:'))).toBe(true);
    expect(lookups).toBe(0);
  });

  it('serves the document to the signer', async () => {
    const { h, envelope } = await sent();
    const token = h.tokenFor('asha@example.com');
    const res = await h.server.app.request(
      `/v1/sign/${token}/documents/${envelope.documents[0].id}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('limits requests per token', async () => {
    const { h } = await sent({}, { limits: { signerRequestsPerMinute: 3 } });
    const token = h.tokenFor('asha@example.com');
    for (let i = 0; i < 3; i++) expect((await h.call('GET', `/v1/sign/${token}`)).status).toBe(200);
    const limited = await h.call('GET', `/v1/sign/${token}`);
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('RATE_LIMITED');
  });

  it('limits requests per IP across tokens', async () => {
    const { h } = await sent({}, { limits: { ipRequestsPerMinute: 2 }, trustProxy: true });
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    await h.call('GET', '/v1/sign/a', { headers });
    await h.call('GET', '/v1/sign/b', { headers });
    expect((await h.call('GET', '/v1/sign/c', { headers })).status).toBe(429);
    const other = await h.call('GET', '/v1/sign/c', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(other.status).toBe(401);
  });
});

describe('signing in order', () => {
  it('runs the whole envelope to a sealed, verified completion', async () => {
    const { h, envelope } = await sent();
    const [asha, ravi] = envelope.recipients;

    const ashaToken = h.tokenFor('asha@example.com');
    expect((await h.call('POST', `/v1/sign/${ashaToken}/view`)).json.recipientStatus).toBe(
      'viewed',
    );
    const early = h.mailer.sent.filter((m) => m.to === 'ravi@example.com');
    expect(early).toHaveLength(0);

    const first = await h.call('POST', `/v1/sign/${ashaToken}/submit`, {
      body: { consent: true, values: [{ fieldId: fieldOf(envelope, asha.id), value: PNG }] },
      headers: { 'user-agent': 'test-browser' },
    });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ envelopeStatus: 'in_progress', recipientStatus: 'signed' });
    expect((await h.call('GET', `/v1/sign/${ashaToken}`)).json.error.code).toBe('TOKEN_INVALID');

    const raviToken = h.tokenFor('ravi@example.com');
    const second = await h.call('POST', `/v1/sign/${raviToken}/submit`, {
      body: { consent: true, values: [{ fieldId: fieldOf(envelope, ravi.id), value: PNG }] },
    });
    expect(second.json.envelopeStatus).toBe('completed');

    const events = await h.call('GET', `/v1/envelopes/${envelope.id}/events`);
    expect(events.json.chainValid).toBe(true);
    const actions = events.json.events.map((e: { action: string }) => e.action);
    expect(actions).toContain('envelope.completed');
    expect(actions.at(-1)).toBe('document.sealed');

    const doc = envelope.documents[0].id;
    const sealed = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${doc}?version=sealed`,
    );
    expect(sealed.status).toBe(200);
    const bytes = new TextDecoder().decode(await sealed.res.arrayBuffer());
    expect(bytes).toContain('fields=3;values=');
    expect(bytes).toContain('sealed;reason=Test seal');

    const certificate = await h.call('GET', `/v1/envelopes/${envelope.id}/certificate`);
    expect(certificate.json.chainValid).toBe(true);
    expect(certificate.json.documents[0].sealedSha256).toMatch(/^[0-9a-f]{64}$/);
    const ashaActions = certificate.json.recipients[0].actions;
    expect(
      ashaActions.find((a: { action: string }) => a.action === 'recipient.signed').userAgent,
    ).toBe('test-browser');

    const copies = h.mailer.sent.filter((m) => m.subject.startsWith('Completed'));
    expect(copies.map((m) => m.to).sort()).toEqual([
      'asha@example.com',
      'hr@example.com',
      'ravi@example.com',
    ]);
    expect(copies[0]?.attachments?.[0]?.filename).toBe('offer.pdf');
  });

  it('requires consent and every required field', async () => {
    const { h } = await sent();
    const token = h.tokenFor('asha@example.com');
    const noConsent = await h.call('POST', `/v1/sign/${token}/submit`, { body: { values: [] } });
    expect(noConsent.status).toBe(400);
    const missing = await h.call('POST', `/v1/sign/${token}/submit`, {
      body: { consent: true, values: [] },
    });
    expect(missing.status).toBe(422);
    expect(missing.json.error.code).toBe('REQUIRED_FIELDS_MISSING');
  });

  it("refuses values for someone else's field", async () => {
    const { h, envelope } = await sent();
    const token = h.tokenFor('asha@example.com');
    const { status, json } = await h.call('POST', `/v1/sign/${token}/submit`, {
      body: {
        consent: true,
        values: [
          { fieldId: fieldOf(envelope, envelope.recipients[0].id), value: PNG },
          { fieldId: fieldOf(envelope, envelope.recipients[1].id), value: PNG },
        ],
      },
    });
    expect(status).toBe(403);
    expect(json.error.code).toBe('FIELD_NOT_YOURS');
  });

  it('rejects a signature that is not a PNG', async () => {
    const { h, envelope } = await sent();
    const token = h.tokenFor('asha@example.com');
    const { status, json } = await h.call('POST', `/v1/sign/${token}/submit`, {
      body: {
        consent: true,
        values: [{ fieldId: fieldOf(envelope, envelope.recipients[0].id), value: 'aGVsbG8=' }],
      },
    });
    expect(status).toBe(422);
    expect(json.error.code).toBe('INVALID_FIELD_VALUE');
  });

  it('stops everyone when a signer declines', async () => {
    const { h } = await sent();
    const token = h.tokenFor('asha@example.com');
    expect((await h.call('POST', `/v1/sign/${token}/decline`, { body: {} })).status).toBe(400);
    const { json } = await h.call('POST', `/v1/sign/${token}/decline`, {
      body: { reason: 'Salary is wrong' },
    });
    expect(json).toEqual({ envelopeStatus: 'declined', recipientStatus: 'declined' });
    expect((await h.call('GET', `/v1/sign/${token}`)).status).toBe(401);
  });

  it('invalidates links when the sender voids', async () => {
    const { h, envelope } = await sent();
    const token = h.tokenFor('asha@example.com');
    await h.call('POST', `/v1/envelopes/${envelope.id}/void`, { body: { reason: 'Mistake' } });
    expect((await h.call('GET', `/v1/sign/${token}`)).json.error.code).toBe('TOKEN_INVALID');
  });
});

describe('OTP', () => {
  const otpBody = () => {
    const body = envelopeBody({ send: true });
    (body.recipients[0] as Record<string, unknown>).auth = 'email_otp';
    return body;
  };

  async function otpEnvelope() {
    const h = harness();
    const { json } = await h.call('POST', '/v1/envelopes', { body: otpBody() });
    return { h, envelope: json, token: h.tokenFor('asha@example.com') };
  }

  it('keeps documents and actions behind the code', async () => {
    const { h, envelope, token } = await otpEnvelope();
    const view = await h.call('GET', `/v1/sign/${token}`);
    expect(view.json).toMatchObject({ otpRequired: true, authenticated: false });
    const doc = await h.call('GET', `/v1/sign/${token}/documents/${envelope.documents[0].id}`);
    expect(doc.status).toBe(401);
    expect(doc.json.error.code).toBe('OTP_INVALID');
    expect((await h.call('POST', `/v1/sign/${token}/view`)).status).toBe(401);
  });

  it('shows no message, fields, values or full address before the code is checked', async () => {
    const h = harness();
    const body = { ...otpBody(), message: 'Your salary is 18 lakh a year.' };
    await h.call('POST', '/v1/envelopes', { body });
    const token = h.tokenFor('asha@example.com');
    const before = await h.call('GET', `/v1/sign/${token}`);
    expect(before.status).toBe(200);
    expect(before.json.envelope.message).toBeNull();
    expect(before.json.fields).toEqual([]);
    expect(before.json.values).toEqual([]);
    expect(before.json.documents).toEqual([]);
    expect(JSON.stringify(before.json)).not.toContain('asha@example.com');
    expect(before.json.recipient.name).toBe('Asha Rao');

    await h.call('POST', `/v1/sign/${token}/otp`);
    const { json: session } = await h.call('POST', `/v1/sign/${token}/otp/verify`, {
      body: { code: h.otp.sent.at(-1)!.code },
    });
    const after = await h.call('GET', `/v1/sign/${token}`, {
      headers: { 'x-sign-session': session.sessionToken },
    });
    expect(after.json.envelope.message).toBe('Your salary is 18 lakh a year.');
    expect(after.json.fields).toHaveLength(1);
    expect(after.json.documents).toHaveLength(1);
    expect(after.json.recipient.email).toBe('asha@example.com');
  });

  it('issues a session after the right code, by header or cookie', async () => {
    const { h, envelope, token } = await otpEnvelope();
    const sendCode = await h.call('POST', `/v1/sign/${token}/otp`);
    expect(sendCode.json.sentTo).not.toContain('asha@');
    const code = h.otp.sent.at(-1)!.code;

    const wrong = await h.call('POST', `/v1/sign/${token}/otp/verify`, {
      body: { code: code === '000000' ? '111111' : '000000' },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.details.attemptsLeft).toBe(4);

    const ok = await h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code } });
    expect(ok.status).toBe(200);
    const cookie = ok.res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/cvsign_session=.+HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const byHeader = await h.call('GET', `/v1/sign/${token}`, {
      headers: { 'x-sign-session': ok.json.sessionToken },
    });
    expect(byHeader.json.authenticated).toBe(true);
    const byCookie = await h.call('POST', `/v1/sign/${token}/submit`, {
      headers: { cookie: cookie.split(';')[0]! },
      body: {
        consent: true,
        values: [{ fieldId: fieldOf(envelope, envelope.recipients[0].id), value: PNG }],
      },
    });
    expect(byCookie.status).toBe(200);

    const replay = await h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code } });
    expect(replay.status).toBe(401);
  });

  it('does not accept a session from another token', async () => {
    const { h, token } = await otpEnvelope();
    await h.call('POST', `/v1/sign/${token}/otp`);
    const ok = await h.call('POST', `/v1/sign/${token}/otp/verify`, {
      body: { code: h.otp.sent.at(-1)!.code },
    });
    h.mailer.sent.length = 0;
    await h.call('POST', '/v1/envelopes', { body: otpBody() });
    const other = h.tokenFor('asha@example.com');
    const res = await h.call('GET', `/v1/sign/${other}`, {
      headers: { 'x-sign-session': ok.json.sessionToken },
    });
    expect(res.json.authenticated).toBe(false);
  });

  it('expires sessions after 30 minutes', async () => {
    const { h, token } = await otpEnvelope();
    await h.call('POST', `/v1/sign/${token}/otp`);
    const ok = await h.call('POST', `/v1/sign/${token}/otp/verify`, {
      body: { code: h.otp.sent.at(-1)!.code },
    });
    h.advance(31 * 60_000);
    const res = await h.call('GET', `/v1/sign/${token}`, {
      headers: { 'x-sign-session': ok.json.sessionToken },
    });
    expect(res.json.authenticated).toBe(false);
  });

  it('locks after five wrong codes, even for the right one', async () => {
    const { h, token } = await otpEnvelope();
    await h.call('POST', `/v1/sign/${token}/otp`);
    const code = h.otp.sent.at(-1)!.code;
    const wrong = code === '123456' ? '654321' : '123456';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(
        (await h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code: wrong } })).json.error
          .code,
      );
    }
    expect(codes.at(-1)).toBe('OTP_LOCKED');
    const right = await h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code } });
    expect(right.status).toBe(423);
  });

  it('counts parallel wrong guesses one by one', async () => {
    const { h, token } = await otpEnvelope();
    await h.call('POST', `/v1/sign/${token}/otp`);
    const code = h.otp.sent.at(-1)!.code;
    const wrong = code === '123456' ? '654321' : '123456';
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code: wrong } }),
      ),
    );
    const errors = results.map((r) => r.json.error.code);
    expect(errors.filter((c) => c === 'OTP_INVALID')).toHaveLength(4);
    expect(errors.filter((c) => c === 'OTP_LOCKED')).toHaveLength(4);
    const right = await h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code } });
    expect(right.json.error.code).toBe('OTP_LOCKED');
  });

  it('invalidates the previous code when a new one is sent', async () => {
    const { h, token } = await otpEnvelope();
    await h.call('POST', `/v1/sign/${token}/otp`);
    const first = h.otp.sent.at(-1)!.code;
    await h.call('POST', `/v1/sign/${token}/otp`);
    const second = h.otp.sent.at(-1)!.code;
    if (first !== second) {
      const old = await h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code: first } });
      expect(old.json.error.code).toBe('OTP_INVALID');
    }
    const ok = await h.call('POST', `/v1/sign/${token}/otp/verify`, { body: { code: second } });
    expect(ok.status).toBe(200);
  });

  it('sends at most ten codes per recipient over the life of an envelope', async () => {
    const { h, token } = await otpEnvelope();
    for (let i = 0; i < 10; i++) {
      expect((await h.call('POST', `/v1/sign/${token}/otp`)).status).toBe(200);
      h.advance(16 * 60_000);
    }
    const capped = await h.call('POST', `/v1/sign/${token}/otp`);
    expect(capped.status).toBe(423);
    expect(capped.json.error).toMatchObject({
      code: 'OTP_LOCKED',
      details: { reason: 'too_many_codes', max: 10 },
    });
    expect(h.otp.sent).toHaveLength(10);
  });

  it('expires codes after ten minutes', async () => {
    const { h, token } = await otpEnvelope();
    await h.call('POST', `/v1/sign/${token}/otp`);
    h.advance(10 * 60_000 + 1);
    const res = await h.call('POST', `/v1/sign/${token}/otp/verify`, {
      body: { code: h.otp.sent.at(-1)!.code },
    });
    expect(res.json.error.code).toBe('OTP_EXPIRED');
  });

  it('limits how often codes are sent', async () => {
    const { h, token } = await otpEnvelope();
    for (let i = 0; i < 5; i++)
      expect((await h.call('POST', `/v1/sign/${token}/otp`)).status).toBe(200);
    expect((await h.call('POST', `/v1/sign/${token}/otp`)).status).toBe(429);
  });

  it('refuses OTP calls for link-only recipients', async () => {
    const { h } = await sent();
    const token = h.tokenFor('asha@example.com');
    expect((await h.call('POST', `/v1/sign/${token}/otp`)).status).toBe(400);
  });
});
