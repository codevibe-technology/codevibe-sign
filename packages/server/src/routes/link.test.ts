import { describe, expect, it } from 'vitest';
import type { SignServerOptions } from '../options';
import { memoryStore } from '../store/memory';
import { envelopeBody, harness, PNG } from '../testing/harness';

async function sent(options: Partial<SignServerOptions> = {}) {
  const store = memoryStore();
  const h = harness({ store, ...options });
  const { json } = await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
  return { h, store, envelope: json, token: h.tokenFor('asha@example.com') };
}

const cookieFrom = (res: Response) =>
  /cvsign_link=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1];

describe('GET /sign/:token', () => {
  it('swaps the token for a strict HttpOnly cookie and redirects to a token-less page', async () => {
    const { h, token } = await sent();
    const res = await h.server.app.request(`/sign/${token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://sign.example.com/sign');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookieFrom(res)).toBe(token);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/Path=\/v1\/sign/);
  });

  it('lets the page act through /v1/sign/link with the cookie alone', async () => {
    const { h, envelope, token } = await sent();
    const cookie = `cvsign_link=${cookieFrom(await h.server.app.request(`/sign/${token}`))}`;
    const view = await h.call('GET', '/v1/sign/link', { headers: { cookie } });
    expect(view.status).toBe(200);
    expect(view.json.recipient.name).toBe('Asha Rao');
    const field = envelope.fields.find(
      (f: { recipientId: string }) => f.recipientId === envelope.recipients[0].id,
    ).id;
    const done = await h.call('POST', '/v1/sign/link/submit', {
      headers: { cookie, 'sec-fetch-site': 'same-origin' },
      body: { consent: true, values: [{ fieldId: field, value: PNG }] },
    });
    expect(done.json.recipientStatus).toBe('signed');
    expect((await h.call('GET', '/v1/sign/link')).json.error.code).toBe('TOKEN_INVALID');
  });

  it('refuses cross-site actions that carry the cookie', async () => {
    const { h, token } = await sent();
    const cookie = `cvsign_link=${token}`;
    const res = await h.call('POST', '/v1/sign/link/view', {
      headers: { cookie, 'sec-fetch-site': 'cross-site' },
    });
    expect(res.json.error.code).toBe('TOKEN_INVALID');
  });

  it('changes nothing when a mail scanner fetches the link or the API', async () => {
    const { h, store, envelope, token } = await sent();
    const before = await store.load(envelope.id);
    const events = (await store.listEvents(envelope.id)).length;
    for (let i = 0; i < 3; i++) {
      await h.server.app.request(`/sign/${token}`);
      await h.server.app.request(`/sign/${token}`, { method: 'HEAD' });
      await h.call('GET', `/v1/sign/${token}`);
      await h.server.app.request(`/v1/sign/${token}/documents/${envelope.documents[0].id}`);
    }
    const after = await store.load(envelope.id);
    expect(after?.version).toBe(before?.version);
    expect(await store.listEvents(envelope.id)).toHaveLength(events);
    expect(after?.envelope.recipients[0]?.status).toBe('notified');
  });

  it('clears the cookie and still redirects for a dead or malformed link', async () => {
    const { h } = await sent({ signingPageUrl: 'https://app.example.com/signing' });
    for (const token of ['A'.repeat(43), 'not-a-token']) {
      const res = await h.server.app.request(`/sign/${token}`);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('https://app.example.com/signing');
      expect(res.headers.get('set-cookie')).toMatch(/cvsign_link=;.*Max-Age=0/);
    }
  });
});
