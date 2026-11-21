import { seal, verifySeal } from '@codevibe_technology/sign-pdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultPdfEngine } from './engine';
import { harness, PNG } from './testing/harness';
import { makeP12, makePdf } from './testing/real-pdf';

describe('end to end with @codevibe_technology/sign-pdf', () => {
  let pdf: Uint8Array;
  let p12: Uint8Array;

  beforeAll(async () => {
    pdf = await makePdf(2);
    p12 = makeP12('Codevibe Sign Test Seal', 'seal-pass');
  });

  const realHarness = () =>
    harness({
      pdf: defaultPdfEngine,
      clock: { now: () => new Date() },
      sealer: { p12, passphrase: 'seal-pass', reason: 'Sealed by test', location: 'Pune' },
    });

  it('signs, seals and verifies a real PDF', async () => {
    const h = realHarness();
    const content = Buffer.from(pdf).toString('base64');
    const created = await h.call('POST', '/v1/envelopes', {
      body: {
        title: 'Offer letter',
        send: true,
        routing: 'parallel',
        documents: [{ name: 'offer.pdf', content }],
        recipients: [
          { key: 'asha', name: 'Asha Rao', email: 'asha@example.com' },
          { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', role: 'approver' },
        ],
        fields: [
          { recipient: 'asha', type: 'signature', page: 1, x: 72, y: 600, width: 180, height: 48 },
          {
            recipient: 'asha',
            type: 'date_signed',
            page: 1,
            x: 72,
            y: 660,
            width: 120,
            height: 16,
          },
          { recipient: 'ravi', type: 'name', page: 0, x: 72, y: 100, width: 200, height: 20 },
        ],
      },
    });
    expect(created.status).toBe(201);
    const envelope = created.json;
    expect(envelope.documents[0].pageSizes[0]).toEqual({ width: 595.28, height: 841.89 });

    const signature = envelope.fields.find((f: { type: string }) => f.type === 'signature').id;
    const ashaToken = h.tokenFor('asha@example.com');
    const signed = await h.call('POST', `/v1/sign/${ashaToken}/submit`, {
      body: { consent: true, values: [{ fieldId: signature, value: PNG }] },
    });
    expect(signed.status).toBe(200);
    const approved = await h.call('POST', `/v1/sign/${h.tokenFor('ravi@example.com')}/submit`, {
      body: { consent: true, values: [] },
    });
    expect(approved.json).toEqual({ envelopeStatus: 'completed', recipientStatus: 'approved' });

    const doc = envelope.documents[0].id;
    const res = await h.server.app.request(
      `/v1/envelopes/${envelope.id}/documents/${doc}?version=sealed`,
      { headers: { authorization: 'Bearer test-key-0123456789abcdef' } },
    );
    expect(res.status).toBe(200);
    const sealed = new Uint8Array(await res.arrayBuffer());
    const check = await verifySeal(sealed);
    expect(check).toMatchObject({ sealed: true, valid: true, coversWholeDocument: true });
    expect(check.signer?.commonName).toBe('Codevibe Sign Test Seal');

    const tampered = new Uint8Array(sealed);
    const at = Math.floor(tampered.length / 4);
    tampered[at] = tampered[at]! ^ 0xff;
    const broken = await verifySeal(tampered);
    expect(broken.valid && broken.coversWholeDocument).toBe(false);

    const certificate = await h.call('GET', `/v1/envelopes/${envelope.id}/certificate`);
    expect(certificate.json.chainValid).toBe(true);
    expect(certificate.json.documents[0].sealedSha256).toMatch(/^[0-9a-f]{64}$/);

    const verification = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${doc}/verification`,
    );
    expect(verification.json).toMatchObject({
      documentId: doc,
      valid: true,
      reason: null,
      signer: { commonName: 'Codevibe Sign Test Seal' },
    });
    expect(verification.json.certificateSha256).toMatch(/^[0-9a-f]{64}$/);

    const key = `envelopes/${envelope.id}/documents/${doc}/sealed.pdf`;
    const foreign = await seal(await makePdf(1), {
      p12: makeP12('Codevibe Sign Test Seal', 'other'),
      passphrase: 'other',
    });
    await h.files.put(key, foreign, 'application/pdf');
    const forged = await h.call(
      'GET',
      `/v1/envelopes/${envelope.id}/documents/${doc}/verification`,
    );
    expect(forged.json).toMatchObject({ valid: false, reason: 'untrusted_signer' });
  }, 60_000);

  it('refuses to start with a weak seal key unless told it is for development', () => {
    const weak = makeP12('Weak Seal', 'weak', 1024);
    expect(() =>
      harness({ pdf: defaultPdfEngine, sealer: { p12: weak, passphrase: 'weak' } }),
    ).toThrow(/2048/);
    expect(() =>
      harness({
        pdf: defaultPdfEngine,
        sealer: { p12: weak, passphrase: 'weak', allowWeakKey: true },
      }),
    ).not.toThrow();
    expect(() =>
      harness({ pdf: defaultPdfEngine, sealer: { p12: weak, passphrase: 'wrong' } }),
    ).toThrow();
  });

  it('rejects a file that only looks like a PDF', async () => {
    const h = realHarness();
    const content = Buffer.from('%PDF-1.7\nnot really a pdf').toString('base64');
    const { status, json } = await h.call('POST', '/v1/envelopes', {
      body: {
        title: 'Broken',
        documents: [{ name: 'x.pdf', content }],
        recipients: [{ name: 'A', email: 'a@example.com' }],
      },
    });
    expect(status).toBe(422);
    expect(json.error.code).toBe('DOCUMENT_INVALID');
  });

  it('rejects a PDF that already carries signatures, and accepts the unsigned original', async () => {
    const h = realHarness();
    const signed = await seal(pdf, { p12, passphrase: 'seal-pass' });
    const body = (bytes: Uint8Array) => ({
      body: {
        title: 'Offer letter',
        documents: [{ name: 'offer.pdf', content: Buffer.from(bytes).toString('base64') }],
        recipients: [{ name: 'A', email: 'a@example.com' }],
      },
    });
    const rejected = await h.call('POST', '/v1/envelopes', body(signed));
    expect(rejected.status).toBe(422);
    expect(rejected.json.error).toEqual({
      code: 'PDF_ALREADY_SIGNED',
      message:
        'This PDF already carries digital signatures. Signing it again here would remove them. Upload the unsigned original.',
      details: { signatureCount: 1 },
    });
    const accepted = await h.call('POST', '/v1/envelopes', body(pdf));
    expect(accepted.status).toBe(201);

    const doc = accepted.json.documents[0].id;
    const replaced = await h.call('PUT', `/v1/envelopes/${accepted.json.id}/documents/${doc}`, {
      body: { name: 'offer.pdf', content: Buffer.from(signed).toString('base64') },
    });
    expect(replaced.status).toBe(422);
    expect(replaced.json.error.code).toBe('PDF_ALREADY_SIGNED');
  });
});
