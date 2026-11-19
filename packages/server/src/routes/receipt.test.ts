import { describe, expect, it } from 'vitest';
import { envelopeBody, harness, PNG } from '../testing/harness';

async function signedByAsha() {
  const h = harness();
  const { json: envelope } = await h.call('POST', '/v1/envelopes', {
    body: envelopeBody({ send: true }),
  });
  const field = (recipient: number) =>
    envelope.fields.find(
      (f: { recipientId: string; type: string }) =>
        f.recipientId === envelope.recipients[recipient].id && f.type === 'signature',
    ).id;
  const submit = await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
    body: { consent: true, values: [{ fieldId: field(0), value: PNG }] },
  });
  const receipt = submit.res.headers.get('x-sign-receipt') ?? '';
  const signRavi = () =>
    h.call('POST', `/v1/sign/${h.tokenFor('ravi@example.com')}/submit`, {
      body: { consent: true, values: [{ fieldId: field(1), value: PNG }] },
    });
  return { h, envelope, submit, receipt, signRavi, docId: envelope.documents[0].id as string };
}

describe('the signing receipt', () => {
  it('is handed back on submit as a strict HttpOnly cookie and a header', async () => {
    const { submit, receipt } = await signedByAsha();
    expect(receipt).toMatch(/^[\w-]+\.[0-9a-f]{64}$/);
    const cookie = submit.res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`cvsign_receipt=${receipt}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/v1\/sign/);
    expect(cookie).toMatch(/Max-Age=604800/);
  });

  it('shows where the envelope stands without naming anyone else', async () => {
    const { h, receipt } = await signedByAsha();
    const { status, json } = await h.call('GET', '/v1/sign/receipt', {
      headers: { cookie: `cvsign_receipt=${receipt}` },
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      workspaceId: 'default',
      envelope: { title: 'Offer letter', status: 'in_progress', completedAt: null },
      recipient: { name: 'Asha Rao', status: 'signed' },
      waitingFor: 1,
      documents: [{ name: 'offer.pdf', sealed: false }],
    });
    expect(JSON.stringify(json)).not.toMatch(/Ravi|ravi@|hr@/);
  });

  it('hands out the sealed copy only once everyone has signed', async () => {
    const { h, receipt, signRavi, docId } = await signedByAsha();
    const headers = { 'x-sign-receipt': receipt };
    const early = await h.call('GET', `/v1/sign/receipt/documents/${docId}`, { headers });
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe('INVALID_STATE');

    await signRavi();
    const view = await h.call('GET', '/v1/sign/receipt', { headers });
    expect(view.json.envelope.status).toBe('completed');
    expect(view.json.documents[0].sealed).toBe(true);
    const copy = await h.call('GET', `/v1/sign/receipt/documents/${docId}`, { headers });
    expect(copy.status).toBe(200);
    expect(copy.res.headers.get('content-disposition')).toMatch(/sealed\.pdf/);
    expect(new TextDecoder().decode(await copy.res.arrayBuffer())).toContain('sealed;');
  });

  it('refuses forged, tampered, missing and old receipts', async () => {
    const { h, receipt, docId } = await signedByAsha();
    const [payload] = receipt.split('.');
    const other = Buffer.from(
      JSON.stringify({ k: 'receipt', e: 'x', r: 'y', exp: Date.now() * 2 }),
    ).toString('base64url');
    for (const value of [`${payload}.${'0'.repeat(64)}`, `${other}.${receipt.split('.')[1]}`]) {
      const res = await h.call('GET', '/v1/sign/receipt', { headers: { 'x-sign-receipt': value } });
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe('TOKEN_INVALID');
    }
    expect((await h.call('GET', '/v1/sign/receipt')).status).toBe(401);
    const missing = await h.call('GET', '/v1/sign/receipt/documents/nope', {
      headers: { 'x-sign-receipt': receipt },
    });
    expect(missing.status).toBe(404);

    h.advance(7 * 86_400_000 + 1);
    const old = await h.call('GET', `/v1/sign/receipt/documents/${docId}`, {
      headers: { 'x-sign-receipt': receipt },
    });
    expect(old.status).toBe(401);
  });

  it('does not take a signer session for a receipt', async () => {
    const h = harness();
    await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({
        send: true,
        recipients: [{ key: 'asha', name: 'Asha', email: 'asha@example.com', auth: 'email_otp' }],
        fields: [
          { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
        ],
      }),
    });
    const token = h.tokenFor('asha@example.com');
    await h.call('POST', `/v1/sign/${token}/otp`);
    const session = await h.call('POST', `/v1/sign/${token}/otp/verify`, {
      body: { code: h.otp.sent.at(-1)!.code },
    });
    const res = await h.call('GET', '/v1/sign/receipt', {
      headers: { 'x-sign-receipt': session.json.sessionToken },
    });
    expect(res.status).toBe(401);
  });
});
