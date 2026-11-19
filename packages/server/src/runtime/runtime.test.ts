import { describe, expect, it } from 'vitest';
import { envelopeBody, harness, PNG, WEBHOOK_SECRET } from '../testing/harness';
import { RETRY_DELAYS_MS } from './jobs';
import { signWebhook, verifyWebhook } from './webhooks';

const DAY = 86_400_000;

describe('webhooks', () => {
  it('signs each delivery over the timestamp and body', async () => {
    const h = harness();
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    const types = h.deliveries.map((d) => JSON.parse(d.body).type);
    expect(types).toEqual(expect.arrayContaining(['envelope.sent', 'recipient.notified']));
    for (const delivery of h.deliveries) {
      const header = delivery.headers['x-codevibe-signature'];
      expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(
        verifyWebhook(WEBHOOK_SECRET, header, delivery.body, {
          now: new Date('2026-03-02T09:00:00Z'),
        }),
      ).toBe(true);
      expect(
        verifyWebhook('wrong-secret-123456', header, delivery.body, {
          now: new Date('2026-03-02T09:00:00Z'),
        }),
      ).toBe(false);
    }
  });

  it('delivers only the events a target asked for', async () => {
    const h = harness({
      webhooks: [
        {
          url: 'https://hooks.example.com/a',
          secret: WEBHOOK_SECRET,
          events: ['envelope.completed'],
        },
      ],
    });
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    expect(h.deliveries).toHaveLength(0);
  });

  it('retries failed deliveries with backoff and gives up in the end', async () => {
    const h = harness();
    h.setWebhookStatus(500);
    await h.call('POST', '/v1/envelopes', { body: envelopeBody() });
    expect(h.deliveries).toHaveLength(0);
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    const firstRound = h.deliveries.length;
    expect(firstRound).toBeGreaterThan(0);
    const body = h.deliveries[0]!.body;

    expect((await h.server.tick()).jobs).toBe(0);
    h.advance(RETRY_DELAYS_MS[0]!);
    const retry = await h.server.tick();
    expect(retry.jobs).toBe(firstRound);
    expect(retry.failedJobs).toBe(firstRound);
    expect(h.deliveries[firstRound]!.body).toBe(body);

    for (const delay of RETRY_DELAYS_MS.slice(1)) {
      h.advance(delay);
      await h.server.tick();
    }
    const total = h.deliveries.length;
    expect(total).toBe(firstRound * (RETRY_DELAYS_MS.length + 1));
    expect(h.logs.some((l) => l.message === 'job failed for the last time')).toBe(true);
    h.advance(DAY);
    await h.server.tick();
    expect(h.deliveries.length).toBe(total);
  });

  it('stops retrying once a delivery succeeds', async () => {
    const h = harness();
    h.setWebhookStatus(503);
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    h.setWebhookStatus(204);
    h.advance(RETRY_DELAYS_MS[0]!);
    const result = await h.server.tick();
    expect(result.failedJobs).toBe(0);
    h.advance(DAY);
    expect((await h.server.tick()).jobs).toBe(0);
  });

  it('checks the signature format and age on the receiving side', () => {
    const body = '{"id":"1"}';
    const header = signWebhook(WEBHOOK_SECRET, body, 1_000);
    expect(verifyWebhook(WEBHOOK_SECRET, header, body, { now: new Date(1_000_000) })).toBe(true);
    expect(verifyWebhook(WEBHOOK_SECRET, header, body, { now: new Date(2_000_000) })).toBe(false);
    expect(verifyWebhook(WEBHOOK_SECRET, header, `${body} `, { now: new Date(1_000_000) })).toBe(
      false,
    );
    expect(verifyWebhook(WEBHOOK_SECRET, 'garbage', body)).toBe(false);
    expect(verifyWebhook(WEBHOOK_SECRET, undefined, body)).toBe(false);
  });
});

describe('tick', () => {
  it('sends reminders when they fall due', async () => {
    const h = harness();
    await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({ send: true, reminders: { firstAfterDays: 2, everyDays: 1, max: 2 } }),
    });
    const reminders = () => h.mailer.sent.filter((m) => m.subject.startsWith('Reminder'));
    h.advance(DAY);
    await h.server.tick();
    expect(reminders()).toHaveLength(0);
    h.advance(DAY);
    expect((await h.server.tick()).changed).toBe(1);
    expect(reminders().map((m) => m.to)).toEqual(['asha@example.com']);
    h.advance(DAY);
    await h.server.tick();
    h.advance(DAY);
    await h.server.tick();
    expect(reminders()).toHaveLength(2);
  });

  it('gives each reminder a working link', async () => {
    const h = harness();
    await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({ send: true, reminders: { firstAfterDays: 1, everyDays: 1, max: 1 } }),
    });
    h.advance(DAY);
    await h.server.tick();
    const token = h.tokenFor('asha@example.com');
    expect((await h.call('GET', `/v1/sign/${token}`)).status).toBe(200);
  });

  it('expires envelopes and their links', async () => {
    const h = harness();
    const { json } = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({ send: true, expiresInDays: 2 }),
    });
    const token = h.tokenFor('asha@example.com');
    h.advance(2 * DAY);
    expect((await h.call('GET', `/v1/sign/${token}`)).json.error.code).toBe('TOKEN_INVALID');
    await h.server.tick();
    expect((await h.call('GET', `/v1/envelopes/${json.id}`)).json.status).toBe('expired');
    expect(h.deliveries.some((d) => JSON.parse(d.body).type === 'envelope.expired')).toBe(true);
  });
});

describe('effects', () => {
  it('runs effects after the response in background mode', async () => {
    const h = harness({ effects: 'background' });
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    await h.server.idle();
    expect(h.mailer.sent.map((m) => m.to)).toEqual(['asha@example.com']);
  });

  it('keeps a failed email for a later tick', async () => {
    const h = harness();
    let fail = true;
    const send = h.mailer.send.bind(h.mailer);
    h.mailer.send = async (message) => {
      if (fail) throw new Error('smtp down');
      return send(message);
    };
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    expect(h.mailer.sent).toHaveLength(0);
    fail = false;
    h.advance(RETRY_DELAYS_MS[0]!);
    await h.server.tick();
    expect(h.mailer.sent.map((m) => m.to)).toEqual(['asha@example.com']);
  });

  it('retries sealing and sends the completed copies once it works', async () => {
    const { fakePdfEngine } = await import('../testing/fake-pdf');
    const engine = fakePdfEngine();
    let broken = true;
    const h = harness({
      pdf: {
        ...engine,
        seal: async (pdf, options) => {
          if (broken) throw new Error('bad p12');
          return engine.seal(pdf, options);
        },
      },
    });
    const { json: envelope } = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({ send: true, routing: 'parallel' }),
    });
    for (const [i, email] of ['asha@example.com', 'ravi@example.com'].entries()) {
      const recipient = envelope.recipients[i];
      const fieldId = envelope.fields.find(
        (f: { recipientId: string; type: string }) =>
          f.recipientId === recipient.id && f.type === 'signature',
      ).id;
      await h.call('POST', `/v1/sign/${h.tokenFor(email)}/submit`, {
        body: { consent: true, values: [{ fieldId, value: PNG }] },
      });
    }
    const completed = () => h.mailer.sent.filter((m) => m.subject.startsWith('Completed'));
    expect(completed()).toHaveLength(0);
    broken = false;
    h.advance(RETRY_DELAYS_MS[0]!);
    await h.server.tick();
    expect(completed()).toHaveLength(3);
    expect(completed()[0]?.attachments).toHaveLength(1);
  });
});
