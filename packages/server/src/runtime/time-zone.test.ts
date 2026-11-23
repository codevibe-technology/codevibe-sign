import { describe, expect, it } from 'vitest';
import type { PdfEngine } from '../engine';
import type { SignServerOptions } from '../options';
import { formatMailDate } from '../time-zone';
import { fakePdfEngine } from '../testing/fake-pdf';
import { envelopeBody, harness, PNG } from '../testing/harness';

/** Runs a one-signer envelope to completion and returns what the PDF engine was asked for. */
async function sealWith(options: Partial<SignServerOptions> = {}) {
  const fake = fakePdfEngine();
  const seen: { render?: string; certificate?: string } = {};
  const pdf: PdfEngine = {
    ...fake,
    renderFields: (bytes, fields, values, recipients, options) => {
      seen.render = options.timeZone;
      return fake.renderFields(bytes, fields, values, recipients, options);
    },
    appendCertificate: (bytes, input) => {
      seen.certificate = input.timeZone;
      return fake.appendCertificate(bytes, input);
    },
  };
  const h = harness({ pdf, ...options });
  const body = envelopeBody({ send: true });
  body.recipients = [body.recipients[0]!];
  body.fields = [body.fields[0]!];
  const { json: envelope } = await h.call('POST', '/v1/envelopes', { body });
  const submitted = await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
    body: { consent: true, values: [{ fieldId: envelope.fields[0].id, value: PNG }] },
  });
  expect(submitted.json.envelopeStatus).toBe('completed');
  return { ...seen, logs: h.logs };
}

describe('timeZone', () => {
  it('draws dates and the certificate in the configured zone', async () => {
    expect(await sealWith({ timeZone: 'Asia/Kolkata' })).toMatchObject({
      render: 'Asia/Kolkata',
      certificate: 'Asia/Kolkata',
    });
  });

  it('leaves the zone out when none is set, so dates stay in UTC', async () => {
    const seen = await sealWith();
    expect([seen.render, seen.certificate]).toEqual([undefined, undefined]);
  });

  it('refuses a zone the runtime does not know when the server is created', () => {
    expect(() => harness({ timeZone: 'Mars/Phobos' })).toThrow(/timeZone.*Asia\/Kolkata/);
  });

  it("prefers the workspace's own zone to the server's", async () => {
    const asked: string[] = [];
    const seen = await sealWith({
      timeZone: 'Asia/Kolkata',
      workspaceTimeZone: async (workspaceId) => {
        asked.push(workspaceId);
        return 'Pacific/Auckland';
      },
    });
    expect(seen).toMatchObject({ render: 'Pacific/Auckland', certificate: 'Pacific/Auckland' });
    expect(new Set(asked)).toEqual(new Set(['default']));
  });

  it("uses the server's zone for a workspace that has not chosen one", async () => {
    const seen = await sealWith({ timeZone: 'Asia/Kolkata', workspaceTimeZone: async () => null });
    expect(seen).toMatchObject({ render: 'Asia/Kolkata', certificate: 'Asia/Kolkata' });
  });

  it('falls back and says so when a workspace names a zone the runtime does not know', async () => {
    const seen = await sealWith({
      timeZone: 'America/New_York',
      workspaceTimeZone: async () => 'Mars/Phobos',
    });
    expect(seen).toMatchObject({ render: 'America/New_York', certificate: 'America/New_York' });
    expect(seen.logs.some((l) => l.level === 'warn' && /time zone/.test(l.message))).toBe(true);
  });

  it('tells the signing page which zone the signing date will be printed in', async () => {
    const zones = ['UTC', 'Asia/Kolkata'] as const;
    for (const zone of zones) {
      const h = harness(zone === 'UTC' ? {} : { workspaceTimeZone: async () => zone });
      await h.call('POST', '/v1/envelopes', { body: envelopeBody({ send: true }) });
      const view = await h.call('GET', `/v1/sign/${h.tokenFor('asha@example.com')}`);
      expect(view.json.timeZone).toBe(zone);
    }
  });

  it('writes the expiry in invitation emails in the workspace zone, with the zone named', async () => {
    const send = async (options: Partial<SignServerOptions>) => {
      const h = harness(options);
      await h.call('POST', '/v1/envelopes', {
        body: { ...envelopeBody({ send: true }), expiresAt: '2026-03-31T18:29:00.000Z' },
      });
      return h.mailer.sent[0]!;
    };
    const utc = await send({});
    expect(utc.text).toContain('expires on 31 Mar 2026, 18:29 UTC.');
    const india = await send({ workspaceTimeZone: async () => 'Asia/Kolkata' });
    expect(india.text).toContain('expires on 31 Mar 2026, 23:59 GMT+5:30.');
    expect(india.html).toContain('31 Mar 2026, 23:59 GMT+5:30');
    const auckland = await send({ timeZone: 'Pacific/Auckland' });
    expect(auckland.text).toContain('expires on 1 Apr 2026, 07:29 GMT+13.');
  });
});

describe('formatMailDate', () => {
  it('names UTC when no zone is given', () => {
    expect(formatMailDate('2026-11-22T18:53:34.000Z')).toBe('22 Nov 2026, 18:53 UTC');
  });

  it('moves to the next or previous day where the zone is on the other side of midnight', () => {
    const lateInUtc = '2026-11-22T18:53:34.000Z';
    expect(formatMailDate(lateInUtc, 'Asia/Kolkata')).toBe('23 Nov 2026, 00:23 GMT+5:30');
    expect(formatMailDate(lateInUtc, 'Pacific/Auckland')).toBe('23 Nov 2026, 07:53 GMT+13');
    expect(formatMailDate('2026-11-23T03:10:00.000Z', 'America/New_York')).toBe(
      '22 Nov 2026, 22:10 GMT-5',
    );
  });

  it('follows daylight saving on both sides of a change', () => {
    expect(formatMailDate('2026-03-08T06:59:00.000Z', 'America/New_York')).toBe(
      '8 Mar 2026, 01:59 GMT-5',
    );
    expect(formatMailDate('2026-03-08T07:00:00.000Z', 'America/New_York')).toBe(
      '8 Mar 2026, 03:00 GMT-4',
    );
    expect(formatMailDate('2026-04-04T13:59:00.000Z', 'Pacific/Auckland')).toBe(
      '5 Apr 2026, 02:59 GMT+13',
    );
    expect(formatMailDate('2026-04-04T14:00:00.000Z', 'Pacific/Auckland')).toBe(
      '5 Apr 2026, 02:00 GMT+12',
    );
  });

  it('returns what it was given when that is not a date', () => {
    expect(formatMailDate('soon', 'Asia/Kolkata')).toBe('soon');
  });
});
