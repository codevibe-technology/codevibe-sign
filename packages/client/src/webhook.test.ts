import { signWebhook } from '@codevibe/sign-server';
import { describe, expect, it } from 'vitest';
import { createSignClient, readWebhook, SIGNATURE_HEADER, verifyWebhook } from '.';
import { API_KEY, BASE_URL, WEBHOOK_SECRET, fakePdf, testServer } from './test/server';

const body = JSON.stringify({ id: 'd1', type: 'envelope.completed', data: {} });
const now = new Date('2026-11-19T10:00:00Z');
const t = Math.floor(now.getTime() / 1000);

describe('verifyWebhook', () => {
  it('accepts what the server signs, as a string or as bytes', async () => {
    const header = signWebhook('s3cret', body, t);
    expect(await verifyWebhook('s3cret', header, body, { now })).toBe(true);
    expect(await verifyWebhook('s3cret', header, new TextEncoder().encode(body), { now })).toBe(
      true,
    );
  });

  it('accepts non-ASCII bodies the same way the server signs them', async () => {
    const text = JSON.stringify({ title: 'Offer for Zoë, ₹ 12 L' });
    expect(await verifyWebhook('s', signWebhook('s', text, t), text, { now })).toBe(true);
  });

  it('rejects a wrong secret, a changed body and a missing or broken header', async () => {
    const header = signWebhook('s3cret', body, t);
    expect(await verifyWebhook('other', header, body, { now })).toBe(false);
    expect(await verifyWebhook('s3cret', header, `${body} `, { now })).toBe(false);
    expect(await verifyWebhook('s3cret', undefined, body, { now })).toBe(false);
    expect(await verifyWebhook('s3cret', '', body, { now })).toBe(false);
    expect(await verifyWebhook('s3cret', 'v1=abc', body, { now })).toBe(false);
    expect(await verifyWebhook('s3cret', `t=${t}`, body, { now })).toBe(false);
    expect(await verifyWebhook('s3cret', `t=abc,v1=00`, body, { now })).toBe(false);
  });

  it('rejects signatures outside the tolerance window, both ways', async () => {
    const old = signWebhook('s', body, t - 301);
    const future = signWebhook('s', body, t + 301);
    expect(await verifyWebhook('s', old, body, { now })).toBe(false);
    expect(await verifyWebhook('s', future, body, { now })).toBe(false);
    expect(await verifyWebhook('s', old, body, { now, toleranceSeconds: 600 })).toBe(true);
  });

  it('accepts any of several v1 signatures, for secret rotation', async () => {
    const fresh = signWebhook('new', body, t);
    const header = `${fresh},v1=${'0'.repeat(64)}`;
    expect(await verifyWebhook('new', header, body, { now })).toBe(true);
  });

  it('verifies a real delivery from the server end to end', async () => {
    const env = testServer();
    const client = createSignClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: env.fetch });
    const envelope = await client.envelopes.create({
      title: 'NDA',
      send: true,
      documents: [{ name: 'nda.pdf', content: fakePdf() }],
      recipients: [{ name: 'Asha', email: 'asha@example.com' }],
      fields: [{ recipient: '0', page: 0, x: 10, y: 10, width: 100, height: 40 }],
    });
    expect(env.deliveries.length).toBeGreaterThan(0);
    for (const delivery of env.deliveries) {
      const header = delivery.headers.get(SIGNATURE_HEADER);
      expect(await verifyWebhook(WEBHOOK_SECRET, header, delivery.body)).toBe(true);
    }
    const sent = env.deliveries.find((d) => d.body.includes('"envelope.sent"'))!;
    const parsed = await readWebhook(WEBHOOK_SECRET, sent.headers.get(SIGNATURE_HEADER), sent.body);
    expect(parsed.type).toBe('envelope.sent');
    expect(parsed.data.envelope.id).toBe(envelope.id);
  });
});

describe('readWebhook', () => {
  it('throws WEBHOOK_INVALID for a bad signature', async () => {
    await expect(readWebhook('s', 't=1,v1=00', body, { now })).rejects.toMatchObject({
      code: 'WEBHOOK_INVALID',
    });
  });
});
