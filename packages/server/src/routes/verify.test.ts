import { SignError } from '@codevibe_technology/sign-core';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../crypto';
import type { SealCheck } from '../engine';
import { fakePdfEngine } from '../testing/fake-pdf';
import { PNG, envelopeBody, harness } from '../testing/harness';
import type { SignServerOptions } from '../options';
import { addressKey } from './verify';

const CERT = 'c'.repeat(64);
const text = (pdf: Uint8Array) => new TextDecoder().decode(pdf);

/** The fake engine, able to tell its own seal from a file that was changed afterwards. */
function sealingEngine(seen: Uint8Array[] = []) {
  return fakePdfEngine({
    sealCertificate: () => ({ sha256: CERT }),
    async verify(pdf): Promise<SealCheck> {
      seen.push(pdf);
      const body = text(pdf);
      if (body.includes('explode')) throw new SignError('DOCUMENT_INVALID', 'Too many objects');
      if (!body.includes('sealed;')) return { valid: false, reason: 'not_sealed' };
      const signed = {
        signer: { commonName: 'Test Seal' },
        signedAt: '2026-03-02T09:00:00.000Z',
        certificateSha256: CERT,
      };
      if (!body.trimEnd().endsWith('reason=Test seal')) {
        return { valid: false, reason: 'not_whole_document', ...signed };
      }
      return { valid: true, ...signed };
    },
  });
}

function verifying(overrides: Partial<SignServerOptions> = {}, seen: Uint8Array[] = []) {
  return harness({ pdf: sealingEngine(seen), ...overrides });
}

/** Sends an envelope through to completion and returns its sealed file. */
async function completed(h: ReturnType<typeof harness>) {
  const recipients = envelopeBody().recipients.slice(0, 1);
  const fields = envelopeBody().fields.slice(0, 1);
  const created = await h.call('POST', '/v1/envelopes', {
    body: envelopeBody({ recipients, fields, send: true }),
  });
  const token = h.tokenFor('asha@example.com');
  const view = await h.call('GET', `/v1/sign/${token}`);
  const signed = await h.call('POST', `/v1/sign/${token}/submit`, {
    body: {
      consent: true,
      values: [{ fieldId: view.json.fields[0].id, value: PNG }],
    },
  });
  expect(signed.json.envelopeStatus, JSON.stringify(signed.json)).toBe('completed');
  const id = created.json.id as string;
  const docId = created.json.documents[0].id as string;
  const file = await h.server.app.request(`/v1/envelopes/${id}/documents/${docId}?version=sealed`, {
    headers: { authorization: 'Bearer test-key-0123456789abcdef' },
  });
  return { id, docId, sealed: new Uint8Array(await file.arrayBuffer()) };
}

const upload = (bytes: Uint8Array, name = 'file') => {
  const form = new FormData();
  form.set(name, new Blob([bytes as BlobPart], { type: 'application/pdf' }), 'sealed.pdf');
  return form;
};

describe('POST /v1/verify', () => {
  it('confirms a sealed file without credentials and names its envelope', async () => {
    const h = verifying();
    const { id, docId, sealed } = await completed(h);
    const res = await h.call('POST', '/v1/verify', { body: upload(sealed), auth: false });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      valid: true,
      reason: null,
      sha256: sha256Hex(sealed),
      checks: {
        sealed: true,
        singleSignature: true,
        intact: true,
        coversWholeDocument: true,
        trustedCertificate: true,
      },
      signer: { commonName: 'Test Seal', organization: null },
      signedAt: '2026-03-02T09:00:00.000Z',
      certificateSha256: CERT,
      envelope: {
        id,
        title: 'Offer letter',
        documentId: docId,
        documentName: 'offer.pdf',
        recipients: [
          { name: 'Asha Rao', contact: 'a****@example.com', role: 'signer', status: 'signed' },
        ],
        chain: { valid: true },
      },
    });
    const { envelope } = res.json;
    expect(envelope.chain.head).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.chain.events).toBe(envelope.events.length);
    expect(envelope.events.at(-1)).toMatchObject({ action: 'document.sealed' });
    expect(JSON.stringify(res.json)).not.toMatch(/asha@example\.com|"ip"|userAgent|fileKey/);
    expect(res.res.headers.get('cache-control')).toBe('no-store');
  });

  it('reports a broken audit chain without a head, and masks phone numbers', async () => {
    const h = verifying();
    const { id, sealed } = await completed(h);
    const stored = (await h.store.load(id))!;
    stored.envelope.recipients[0]!.email = undefined;
    stored.envelope.recipients[0]!.phone = '+919876543210';
    const events = await h.store.listEvents(id);
    h.store.get = async () => stored.envelope;
    h.store.listEvents = async () =>
      events.map((e, i) => (i === 1 ? { ...e, at: e.at.replace('2026', '2025') } : e));
    const res = await h.call('POST', '/v1/verify', { body: upload(sealed) });
    expect(res.json.valid).toBe(true);
    expect(res.json.envelope.chain).toEqual({ valid: false, head: null, events: events.length });
    expect(res.json.envelope.recipients[0].contact).toMatch(/^\+91\*+\d{2,4}$/);
    expect(JSON.stringify(res.json)).not.toContain('9876543210');
  });

  it('takes the PDF as a raw body too', async () => {
    const h = verifying();
    const { sealed } = await completed(h);
    const res = await h.call('POST', '/v1/verify', {
      body: text(sealed),
      headers: { 'content-type': 'application/pdf' },
    });
    expect(res.json.valid).toBe(true);
  });

  it('says which check failed, and names no envelope then', async () => {
    const h = verifying();
    const { sealed } = await completed(h);
    const changed = new TextEncoder().encode(`${text(sealed)}one more page\n`);
    const tampered = await h.call('POST', '/v1/verify', { body: upload(changed) });
    expect(tampered.json).toMatchObject({
      valid: false,
      reason: 'not_whole_document',
      checks: {
        sealed: true,
        singleSignature: true,
        intact: true,
        coversWholeDocument: false,
        trustedCertificate: null,
      },
      envelope: null,
    });

    const plain = await h.call('POST', '/v1/verify', {
      body: upload(new TextEncoder().encode('%PDF-1.7\npages=1\n')),
    });
    expect(plain.json).toMatchObject({
      valid: false,
      reason: 'not_sealed',
      checks: { sealed: false, singleSignature: null, intact: null },
      signer: null,
      envelope: null,
    });

    const hostile = await h.call('POST', '/v1/verify', {
      body: upload(new TextEncoder().encode('%PDF-1.7\nexplode\n')),
    });
    expect(hostile.status).toBe(200);
    expect(hostile.json).toMatchObject({ valid: false, reason: 'unreadable' });
  });

  it('refuses what is not a PDF upload before parsing anything', async () => {
    const seen: Uint8Array[] = [];
    const h = verifying({ limits: { maxPdfBytes: 64 } }, seen);
    const cases: [unknown, Record<string, string>, number, string][] = [
      [{ sha256: 'a'.repeat(64) }, {}, 400, 'VALIDATION'],
      [upload(new TextEncoder().encode('%PDF-1.7\n'), 'document'), {}, 400, 'VALIDATION'],
      [upload(new TextEncoder().encode('GIF89a not a pdf')), {}, 422, 'DOCUMENT_INVALID'],
      [
        upload(new TextEncoder().encode(`%PDF-1.7\n${'x'.repeat(80)}`)),
        {},
        413,
        'DOCUMENT_TOO_LARGE',
      ],
      ['x'.repeat(70_000), { 'content-type': 'application/pdf' }, 413, 'DOCUMENT_TOO_LARGE'],
    ];
    for (const [body, headers, status, code] of cases) {
      const res = await h.call('POST', '/v1/verify', { body, headers });
      expect(res.status, code).toBe(status);
      expect(res.json.error.code).toBe(code);
    }
    expect(seen).toEqual([]);
  });

  it('creates nothing', async () => {
    const h = verifying();
    const { sealed } = await completed(h);
    const before = JSON.stringify([
      await h.store.list!('default', { limit: 100 }),
      await h.store.listEvents((await h.store.list!('default', { limit: 1 })).envelopes[0]!.id),
      h.mailer.sent.length,
      h.deliveries.length,
    ]);
    const puts: string[] = [];
    const put = h.files.put.bind(h.files);
    h.files.put = async (key, bytes, type) => {
      puts.push(key);
      await put(key, bytes, type);
    };
    await h.call('POST', '/v1/verify', { body: upload(sealed) });
    await h.call('GET', `/v1/verify/${sha256Hex(sealed)}`);
    await h.server.idle();
    const after = JSON.stringify([
      await h.store.list!('default', { limit: 100 }),
      await h.store.listEvents((await h.store.list!('default', { limit: 1 })).envelopes[0]!.id),
      h.mailer.sent.length,
      h.deliveries.length,
    ]);
    expect(after).toBe(before);
    expect(puts).toEqual([]);
  });

  it('limits checks per address, and together when the address is unknown', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\npages=1\n');
    const shared = verifying({ limits: { verifyPer10Minutes: 1, verifySharedPer10Minutes: 2 } });
    expect((await shared.call('POST', '/v1/verify', { body: upload(pdf) })).status).toBe(200);
    expect((await shared.call('GET', `/v1/verify/${'a'.repeat(64)}`)).status).toBe(200);
    const refused = await shared.call('POST', '/v1/verify', { body: upload(pdf) });
    expect(refused.status).toBe(429);
    expect(Number(refused.res.headers.get('retry-after'))).toBeGreaterThan(0);
    shared.advance(10 * 60 * 1000);
    expect((await shared.call('POST', '/v1/verify', { body: upload(pdf) })).status).toBe(200);

    const proxied = verifying({ trustProxy: true, limits: { verifyPer10Minutes: 1 } });
    const from = (ip: string) => ({ 'x-forwarded-for': `203.0.113.250, ${ip}` });
    const first = await proxied.call('POST', '/v1/verify', {
      body: upload(pdf),
      headers: from('198.51.100.1'),
    });
    expect(first.status).toBe(200);
    const second = await proxied.call('GET', `/v1/verify/${'a'.repeat(64)}`, {
      headers: from('198.51.100.1'),
    });
    expect(second.status).toBe(429);
    const other = await proxied.call('POST', '/v1/verify', {
      body: upload(pdf),
      headers: from('198.51.100.2'),
    });
    expect(other.status).toBe(200);
  });

  it('counts an IPv6 client by its /64, and refuses before reading the body', async () => {
    expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:0db8:0001:0002::ffff')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');

    const pdf = new TextEncoder().encode('%PDF-1.7\npages=1\n');
    const h = verifying({ trustProxy: true, limits: { verifyPer10Minutes: 1, maxPdfBytes: 64 } });
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    const first = await h.call('POST', '/v1/verify', {
      body: upload(pdf),
      headers: from('2001:db8:1:2::1'),
    });
    expect(first.status).toBe(200);
    const neighbour = await h.call('POST', '/v1/verify', {
      body: 'x'.repeat(200_000),
      headers: { ...from('2001:db8:1:2:ffff::9'), 'content-type': 'application/pdf' },
    });
    expect(neighbour.status).toBe(429);
    const elsewhere = await h.call('GET', `/v1/verify/${'a'.repeat(64)}`, {
      headers: from('2001:db8:1:3::1'),
    });
    expect(elsewhere.status).toBe(200);
  });

  it('asks callers to retry while too many files are being checked', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      limits: { maxConcurrentVerifications: 1 },
      pdf: fakePdfEngine({
        sealCertificate: () => ({ sha256: CERT }),
        async verify() {
          await gate;
          return { valid: false, reason: 'not_sealed' };
        },
      }),
    });
    const pdf = new TextEncoder().encode('%PDF-1.7\npages=1\n');
    const slow = h.call('POST', '/v1/verify', { body: upload(pdf) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const busy = await h.call('POST', '/v1/verify', { body: upload(pdf) });
    expect(busy.status).toBe(429);
    release();
    expect((await slow).status).toBe(200);
    expect((await h.call('POST', '/v1/verify', { body: upload(pdf) })).status).toBe(200);
  });

  it('cannot verify without a seal certificate to compare with', async () => {
    const h = harness();
    const res = await h.call('POST', '/v1/verify', {
      body: upload(new TextEncoder().encode('%PDF-1.7\n')),
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('INVALID_STATE');
  });
});

describe('GET /v1/verify/:sha256', () => {
  it('answers like the upload for the hash of a sealed file', async () => {
    const h = verifying();
    const { id, sealed } = await completed(h);
    const hash = sha256Hex(sealed);
    const byHash = await h.call('GET', `/v1/verify/${hash.toUpperCase()}`, { auth: false });
    const byFile = await h.call('POST', '/v1/verify', { body: upload(sealed) });
    expect(byHash.status).toBe(200);
    expect(byHash.json).toEqual(byFile.json);
    expect(byHash.json.envelope.id).toBe(id);
  });

  it('knows nothing about other hashes, the original file included', async () => {
    const h = verifying();
    const { id, docId } = await completed(h);
    const original = await h.server.app.request(
      `/v1/envelopes/${id}/documents/${docId}?version=original`,
      { headers: { authorization: 'Bearer test-key-0123456789abcdef' } },
    );
    for (const hash of ['0'.repeat(64), sha256Hex(new Uint8Array(await original.arrayBuffer()))]) {
      const res = await h.call('GET', `/v1/verify/${hash}`);
      expect(res.json).toEqual({
        valid: false,
        reason: 'unknown_document',
        sha256: hash,
        checks: {
          sealed: null,
          singleSignature: null,
          intact: null,
          coversWholeDocument: null,
          trustedCertificate: null,
        },
        signer: null,
        signedAt: null,
        certificateSha256: null,
        seal: 'operator',
        earlierSignatures: [],
        envelope: null,
      });
    }
  });

  it('does not vouch for a stored file that no longer matches its hash', async () => {
    const h = verifying();
    const { id, docId, sealed } = await completed(h);
    await h.files.put(
      `envelopes/${id}/documents/${docId}/sealed.pdf`,
      new TextEncoder().encode('%PDF-1.7\nswapped sealed;reason=Test seal\n'),
      'application/pdf',
    );
    const res = await h.call('GET', `/v1/verify/${sha256Hex(sealed)}`);
    expect(res.json).toMatchObject({ valid: false, reason: 'unknown_document', envelope: null });
  });

  it('refuses anything that is not a SHA-256', async () => {
    const h = verifying();
    for (const hash of ['abc', 'z'.repeat(64), `${'a'.repeat(64)}0`, '..%2F..%2Fetc']) {
      const res = await h.call('GET', `/v1/verify/${hash}`);
      expect(res.status, hash).toBe(400);
      expect(res.json.error.details.issues[0].path).toBe('sha256');
    }
  });
});
