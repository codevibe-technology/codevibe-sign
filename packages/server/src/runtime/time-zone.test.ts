import { describe, expect, it } from 'vitest';
import type { PdfEngine } from '../engine';
import { fakePdfEngine } from '../testing/fake-pdf';
import { envelopeBody, harness, PNG } from '../testing/harness';

/** Runs a one-signer envelope to completion and returns what the PDF engine was asked for. */
async function sealWith(timeZone?: string) {
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
  const h = harness({ pdf, ...(timeZone ? { timeZone } : {}) });
  const body = envelopeBody({ send: true });
  body.recipients = [body.recipients[0]!];
  body.fields = [body.fields[0]!];
  const { json: envelope } = await h.call('POST', '/v1/envelopes', { body });
  const submitted = await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
    body: { consent: true, values: [{ fieldId: envelope.fields[0].id, value: PNG }] },
  });
  expect(submitted.json.envelopeStatus).toBe('completed');
  return seen;
}

describe('timeZone', () => {
  it('draws dates and the certificate in the configured zone', async () => {
    expect(await sealWith('Asia/Kolkata')).toEqual({
      render: 'Asia/Kolkata',
      certificate: 'Asia/Kolkata',
    });
  });

  it('leaves the zone out when none is set, so dates stay in UTC', async () => {
    expect(await sealWith()).toEqual({ render: undefined, certificate: undefined });
  });

  it('refuses a zone the runtime does not know when the server is created', () => {
    expect(() => harness({ timeZone: 'Mars/Phobos' })).toThrow(/timeZone.*Asia\/Kolkata/);
  });
});
