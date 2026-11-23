import { describe, expect, it } from 'vitest';
import { envelopeBody, harness, PNG, WEBHOOK_SECRET } from '../testing/harness';
import { fakePdfEngine } from '../testing/fake-pdf';
import { RETRY_DELAYS_MS } from './jobs';
import type { WebhookDeliveryReport } from '../options';
import { signWebhook, TEST_EVENT, verifyWebhook } from './webhooks';

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

  it('reports every attempt with its status and the next retry', async () => {
    const reports: WebhookDeliveryReport[] = [];
    const h = harness({ onWebhookDelivery: (r) => void reports.push(r) });
    h.setWebhookStatus(500);
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    expect(reports.length).toBe(h.deliveries.length);
    const first = reports[0]!;
    expect(first).toMatchObject({
      workspaceId: 'default',
      url: 'https://hooks.example.com/sign',
      attempt: 1,
      outcome: 'failed',
      status: 500,
      error: 'Webhook hooks.example.com answered 500',
    });
    expect(first.body).toBe(h.deliveries[0]!.body);
    expect(first.event).toBe(JSON.parse(first.body).type);
    expect(first.retryAt?.getTime()).toBe(first.at.getTime() + RETRY_DELAYS_MS[0]!);

    h.setWebhookStatus(204);
    h.advance(RETRY_DELAYS_MS[0]!);
    await h.server.tick();
    const retried = reports.find((r) => r.deliveryId === first.deliveryId && r.attempt === 2);
    expect(retried).toMatchObject({
      outcome: 'delivered',
      status: 204,
      error: null,
      retryAt: null,
    });
  });

  it('reports the last attempt without a retry time', async () => {
    const reports: WebhookDeliveryReport[] = [];
    const h = harness({
      onWebhookDelivery: (r) => void reports.push(r),
      webhooks: [
        { url: 'https://hooks.example.com/a', secret: WEBHOOK_SECRET, events: ['envelope.sent'] },
      ],
    });
    h.setWebhookStatus(500);
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    for (const delay of RETRY_DELAYS_MS) {
      h.advance(delay);
      await h.server.tick();
    }
    const last = reports.at(-1)!;
    expect(last.attempt).toBe(RETRY_DELAYS_MS.length + 1);
    expect(last.outcome).toBe('failed');
    expect(last.retryAt).toBeNull();
  });

  it('keeps delivering when the report hook throws', async () => {
    const h = harness({
      onWebhookDelivery: () => {
        throw new Error('log is down');
      },
    });
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    expect(h.deliveries.length).toBeGreaterThan(0);
    expect(h.logs.some((l) => l.message === 'onWebhookDelivery failed')).toBe(true);
    expect((await h.server.tick()).failedJobs).toBe(0);
  });

  it('reports a delivery whose target was removed as skipped', async () => {
    const reports: WebhookDeliveryReport[] = [];
    let targets = [{ url: 'https://hooks.example.com/w', secret: WEBHOOK_SECRET, events: ['*'] }];
    const h = harness({
      webhooks: [],
      webhookTargets: async () => targets,
      onWebhookDelivery: (r) => void reports.push(r),
      authenticate: async () => ({ id: 'k', workspaceId: 'ws_1' }),
    });
    h.setWebhookStatus(500);
    await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
    const sent = h.deliveries.length;
    targets = [];
    h.advance(RETRY_DELAYS_MS[0]!);
    await h.server.tick();
    expect(h.deliveries.length).toBe(sent);
    expect(reports.at(-1)).toMatchObject({ workspaceId: 'ws_1', outcome: 'skipped', status: null });
  });

  it('sends a test event to a target now, signed, without queueing a retry', async () => {
    const reports: WebhookDeliveryReport[] = [];
    const h = harness({ onWebhookDelivery: (r) => void reports.push(r) });
    const report = await h.server.sendTestWebhook({
      workspaceId: 'default',
      url: 'https://hooks.example.com/sign',
    });
    expect(report).toMatchObject({ outcome: 'delivered', status: 200, event: TEST_EVENT });
    expect(reports).toEqual([report]);
    const delivery = h.deliveries[0]!;
    expect(JSON.parse(delivery.body)).toMatchObject({
      id: report.deliveryId,
      type: 'webhook.test',
    });
    expect(delivery.headers['x-codevibe-delivery']).toBe(report.deliveryId);
    expect(
      verifyWebhook(WEBHOOK_SECRET, delivery.headers['x-codevibe-signature'], delivery.body, {
        now: new Date('2026-03-02T09:00:00Z'),
      }),
    ).toBe(true);

    h.setWebhookStatus(404);
    const failed = await h.server.sendTestWebhook({
      workspaceId: 'default',
      url: 'https://hooks.example.com/sign',
    });
    expect(failed).toMatchObject({ outcome: 'failed', status: 404, retryAt: null });
    h.advance(DAY);
    expect((await h.server.tick()).jobs).toBe(0);

    const unknown = await h.server.sendTestWebhook({
      workspaceId: 'default',
      url: 'https://elsewhere.example.com/',
    });
    expect(unknown.outcome).toBe('skipped');
    expect(h.deliveries).toHaveLength(2);
  });

  it('redelivers the same body under the same id', async () => {
    const h = harness();
    const original = JSON.stringify({ id: 'd_1', type: 'envelope.completed', data: {} });
    const report = await h.server.redeliverWebhook({
      workspaceId: 'default',
      url: 'https://hooks.example.com/sign',
      deliveryId: 'd_1',
      body: original,
    });
    expect(report).toMatchObject({
      deliveryId: 'd_1',
      outcome: 'delivered',
      event: 'envelope.completed',
    });
    expect(h.deliveries[0]!.body).toBe(original);
    expect(h.deliveries[0]!.headers['x-codevibe-delivery']).toBe('d_1');
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

describe('sealing', () => {
  it('passes the timestamp authority to the seal and logs an optional timestamp failure', async () => {
    const { fakePdfEngine } = await import('../testing/fake-pdf');
    const engine = fakePdfEngine();
    const seen: { tsaUrl?: string; tsaRequired?: boolean }[] = [];
    const h = harness({
      sealer: {
        p12: new Uint8Array([1]),
        passphrase: '',
        tsaUrl: 'http://tsa.example.com',
        tsaRequired: false,
      },
      pdf: {
        ...engine,
        seal: async (pdf, options) => {
          seen.push({ tsaUrl: options.tsaUrl, tsaRequired: options.tsaRequired });
          options.onTimestampFailure?.(new Error('tsa down'));
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
    expect(seen[0]).toEqual({ tsaUrl: 'http://tsa.example.com', tsaRequired: false });
    expect(h.logs).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'sealed without a timestamp' }),
    );
  });

  it('keeps a sealed file that does not verify against the operator certificate', async () => {
    const h = harness({
      pdf: fakePdfEngine({
        sealCertificate: () => ({ sha256: 'a'.repeat(64) }),
        verify: async () => ({ valid: false, reason: 'untrusted_signer' }),
      }),
    });
    const { json: envelope } = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({
        send: true,
        recipients: [
          { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' },
        ],
        fields: [
          { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
        ],
      }),
    });
    const field = envelope.fields[0].id;
    const done = await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
      body: { consent: true, values: [{ fieldId: field, value: PNG }] },
    });
    expect(done.json.envelopeStatus).toBe('completed');
    const doc = envelope.documents[0].id;
    const sealed = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${doc}?version=sealed`,
    );
    expect(sealed.status).toBe(409);
    expect(JSON.stringify(h.logs)).toMatch(/did not verify/);
  });

  it("prints the workspace's note on the certificate", async () => {
    const asked: string[] = [];
    const h = harness({
      certificateNote: async (workspaceId) => {
        asked.push(workspaceId);
        return 'Acme Pvt Ltd, CIN U72900KA2020PTC000000';
      },
    });
    const { json: envelope } = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({
        send: true,
        recipients: [
          { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' },
        ],
        fields: [
          { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
        ],
      }),
    });
    await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
      body: { consent: true, values: [{ fieldId: envelope.fields[0].id, value: PNG }] },
    });
    const doc = envelope.documents[0].id;
    const sealed = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${doc}?version=sealed`,
    );
    const text = new TextDecoder().decode(await sealed.res.arrayBuffer());
    expect(text).toContain('note=Acme Pvt Ltd, CIN U72900KA2020PTC000000');
    expect(asked).toEqual(['default']);
  });

  it('puts the sender and the record link on the certificate', async () => {
    const asked: string[] = [];
    const h = harness({
      certificateDetails: async ({ workspaceId, envelope }) => {
        asked.push(`${workspaceId}:${envelope.status}`);
        return {
          sender: { name: 'Meera Iyer', organization: 'Acme Pvt Ltd' },
          recordUrl: `https://sign.example.com/r/record-of-${envelope.id}`,
        };
      },
    });
    const { json: envelope } = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({
        send: true,
        recipients: [
          { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' },
        ],
        fields: [
          { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
        ],
      }),
    });
    await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
      body: { consent: true, values: [{ fieldId: envelope.fields[0].id, value: PNG }] },
    });
    const sealed = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${envelope.documents[0].id}?version=sealed`,
    );
    const text = new TextDecoder().decode(await sealed.res.arrayBuffer());
    expect(text).toContain('sender=Meera Iyer');
    expect(text).toContain(`record=https://sign.example.com/r/record-of-${envelope.id}`);
    expect(asked).toEqual(['default:completed']);
  });
});
