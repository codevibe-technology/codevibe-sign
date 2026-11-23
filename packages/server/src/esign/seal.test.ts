import { seal, verify, verifySignatures } from '@codevibe_technology/sign-pdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultPdfEngine } from '../engine';
import { fakeEsignProvider } from '../testing/fake-esign';
import { API_KEY, harness, PNG } from '../testing/harness';
import { makeP12, makePdf } from '../testing/real-pdf';

const WEBHOOK = '/v1/esign/webhooks/leegality';

describe('an Aadhaar eSign with real files', () => {
  let pdf: Uint8Array;
  let sealP12: Uint8Array;
  let espP12: Uint8Array;

  beforeAll(async () => {
    pdf = await makePdf(2);
    sealP12 = makeP12('Operator Seal', 'pass');
    espP12 = makeP12('RAVI KUMAR', 'esp');
  });

  /** One Aadhaar signer; the provider signs the way `locked` says. */
  async function run(locked: boolean) {
    let signed: Uint8Array | undefined;
    const provider = fakeEsignProvider({
      sign: async (bytes) =>
        (signed ??= await seal(bytes, { p12: espP12, passphrase: 'esp', certify: locked })),
    });
    const h = harness({
      pdf: defaultPdfEngine,
      clock: { now: () => new Date() },
      sealer: { p12: sealP12, passphrase: 'pass' },
      esign: { provider: async () => provider },
    });
    const created = await h.call('POST', '/v1/envelopes', {
      body: {
        title: 'Appointment letter',
        send: true,
        documents: [{ key: 'd', name: 'letter.pdf', content: Buffer.from(pdf).toString('base64') }],
        recipients: [
          { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', auth: 'aadhaar' },
        ],
        fields: [
          { recipient: 'ravi', type: 'signature', page: 1, x: 72, y: 600, width: 180, height: 48 },
        ],
      },
    });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    const docId = created.json.documents[0].id as string;
    const token = h.tokenFor('ravi@example.com');
    const started = await h.call('POST', `/v1/sign/${token}/esign`, {
      body: { consent: true, values: [{ fieldId: created.json.fields[0].id, value: PNG }] },
    });
    expect(started.status).toBe(200);
    const ref = provider.requests[0]!.ref;
    provider.finish(ref);
    const hook = await h.call('POST', WEBHOOK, { body: provider.webhook(ref, 'signed') });
    expect(hook.status).toBe(200);
    const file = async (version: string) =>
      new Uint8Array(
        await (
          await h.server.app.request(`/v1/envelopes/${id}/documents/${docId}?version=${version}`, {
            headers: { authorization: `Bearer ${API_KEY}` },
          })
        ).arrayBuffer(),
      );
    const esigned = await provider.fetchSignedDocument(ref);
    return { h, id, docId, file, esigned };
  }

  it('adds the seal after the provider signature and leaves its bytes alone', async () => {
    const { h, id, docId, file, esigned } = await run(false);
    const sealed = await file('sealed');
    expect(sealed.byteLength).toBeGreaterThan(esigned.byteLength);
    expect(Buffer.from(sealed.subarray(0, esigned.byteLength)).equals(Buffer.from(esigned))).toBe(
      true,
    );
    const signatures = await verifySignatures(sealed);
    expect(signatures.map((s) => [s.valid, s.signer?.commonName, s.coversWholeDocument])).toEqual([
      [true, 'RAVI KUMAR', false],
      [true, 'Operator Seal', true],
    ]);

    const check = await h.call('GET', `/v1/envelopes/${id}/documents/${docId}/verification`);
    expect(check.json).toMatchObject({
      valid: true,
      reason: null,
      seal: 'operator',
      signer: { commonName: 'Operator Seal' },
      earlierSignatures: [
        { valid: true, signerCommonName: 'RAVI KUMAR', issuerCommonName: 'RAVI KUMAR' },
      ],
    });

    const form = new FormData();
    form.set('file', new Blob([sealed], { type: 'application/pdf' }), 'sealed.pdf');
    const open = await h.call('POST', '/v1/verify', { body: form });
    expect(open.json).toMatchObject({
      valid: true,
      seal: 'operator',
      checks: { sealed: true, intact: true, coversWholeDocument: true, trustedCertificate: true },
      earlierSignatures: [{ valid: true, signerCommonName: 'RAVI KUMAR' }],
      envelope: { id, documentId: docId },
    });
    expect(open.json.envelope.recipients[0]).toMatchObject({
      auth: 'aadhaar',
      status: 'signed',
      esign: { provider: 'leegality' },
    });

    const tampered = new Uint8Array(sealed);
    tampered[400] = tampered[400]! ^ 1;
    const tamperedForm = new FormData();
    tamperedForm.set('file', new Blob([tampered], { type: 'application/pdf' }), 'sealed.pdf');
    const broken = await h.call('POST', '/v1/verify', { body: tamperedForm });
    expect(broken.json).toMatchObject({ valid: false, envelope: null });

    const certificate = await file('certificate');
    const trust = { certificates: [] as string[], fingerprints: [check.json.certificateSha256] };
    expect((await verify(certificate, { trust })).valid).toBe(true);
    const events = (await h.call('GET', `/v1/envelopes/${id}/events`)).json.events as {
      action: string;
      data?: Record<string, unknown>;
    }[];
    expect(events.find((e) => e.action === 'document.sealed')!.data).toMatchObject({
      seal: 'countersigned',
      certificate: 'separate',
    });
    const signedEvent = events.find((e) => e.action === 'recipient.signed')!;
    expect(signedEvent.data).toMatchObject({ method: 'aadhaar_esign', signerName: 'RAVI KUMAR' });
    expect(JSON.stringify(events)).not.toMatch(/\b\d{12}\b/);
  }, 60_000);

  it('keeps a file the provider certified against changes and still recognises it', async () => {
    const { h, id, docId, file, esigned } = await run(true);
    const sealed = await file('sealed');
    expect(Buffer.from(sealed).equals(Buffer.from(esigned))).toBe(true);

    const check = await h.call('GET', `/v1/envelopes/${id}/documents/${docId}/verification`);
    expect(check.json).toMatchObject({
      valid: true,
      reason: null,
      seal: 'provider_only',
      earlierSignatures: [{ valid: true, signerCommonName: 'RAVI KUMAR' }],
    });
    const byHash = await h.call('GET', `/v1/verify/${check.json.sha256}`);
    expect(byHash.json).toMatchObject({ valid: true, envelope: { id } });

    const form = new FormData();
    form.set('file', new Blob([sealed], { type: 'application/pdf' }), 'sealed.pdf');
    const open = await h.call('POST', '/v1/verify', { body: form });
    expect(open.json).toMatchObject({ valid: true, seal: 'provider_only', envelope: { id } });

    const changed = new Uint8Array(sealed);
    changed[400] = changed[400]! ^ 1;
    const changedForm = new FormData();
    changedForm.set('file', new Blob([changed], { type: 'application/pdf' }), 'sealed.pdf');
    expect((await h.call('POST', '/v1/verify', { body: changedForm })).json.valid).toBe(false);
    expect((await file('certificate')).byteLength).toBeGreaterThan(1000);
  }, 60_000);
});
