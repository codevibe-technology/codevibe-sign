import type { MailMessage, Mailer } from '@codevibe_technology/sign-core';
import { describe, expect, it } from 'vitest';
import { envelopeBody, harness, PNG } from '../testing/harness';

const oneSigner = {
  recipients: [{ key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' }],
  fields: [
    { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
  ],
};

async function complete(h: ReturnType<typeof harness>) {
  const { json: envelope } = await h.call('POST', '/v1/envelopes', {
    body: envelopeBody({ send: true, ...oneSigner }),
  });
  await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
    body: { consent: true, values: [{ fieldId: envelope.fields[0].id, value: PNG }] },
  });
  return envelope as { id: string; documents: { id: string }[] };
}

const completedCopies = (sent: MailMessage[]) =>
  sent.filter((m) => m.meta?.kind === 'completed_copy');

describe('completed copy delivery', () => {
  it('sends download links when the sealed files are over the attachment limit', async () => {
    const h = harness({ limits: { maxAttachmentBytes: 1 } });
    const envelope = await complete(h);
    const [copy] = completedCopies(h.mailer.sent);
    expect(copy?.attachments).toBeUndefined();
    const url = copy?.text.match(/https:\/\/sign\.example\.com\/v1\/sign\/copy\/\S+/)?.[0];
    expect(url).toBeDefined();
    expect(copy?.html).toContain('/v1/sign/copy/');
    const path = url!.replace('https://sign.example.com', '');
    expect(path).toContain(`/v1/sign/copy/${envelope.documents[0]!.id}?c=`);
    const res = await h.call('GET', path);
    expect(res.res.headers.get('content-type')).toBe('application/pdf');
  });

  it('sends links when a sealed file cannot be read', async () => {
    const h = harness();
    const get = h.files.get.bind(h.files);
    h.files.get = async (key) => {
      if (key.endsWith('/sealed.pdf')) throw new Error('disk error');
      return get(key);
    };
    await complete(h);
    const [copy] = completedCopies(h.mailer.sent);
    expect(copy?.attachments).toBeUndefined();
    expect(copy?.text).toContain('/v1/sign/copy/');
    expect(h.logs.some((l) => l.message.startsWith('sealed file could not be read'))).toBe(true);
  });

  it('falls back to links when the provider refuses the attachment', async () => {
    const sent: MailMessage[] = [];
    const mailer: Mailer = {
      async send(message) {
        if (message.attachments?.length) throw new Error('552 message size exceeds limit');
        sent.push(message);
      },
    };
    const h = harness({ mailer });
    const { json: envelope } = await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({ send: true, ...oneSigner }),
    });
    const token = sent[0]!.text.match(/\/sign\/([A-Za-z0-9_-]+)/)![1];
    await h.call('POST', `/v1/sign/${token}/submit`, {
      body: { consent: true, values: [{ fieldId: envelope.fields[0].id, value: PNG }] },
    });
    const copies = completedCopies(sent);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.text).toContain('/v1/sign/copy/');
    expect(h.logs.some((l) => l.message.startsWith('completed copy with attachments'))).toBe(true);
  });

  it('refuses forged, expired and foreign copy links', async () => {
    const h = harness({ limits: { maxAttachmentBytes: 1 } });
    await complete(h);
    const url = completedCopies(h.mailer.sent)[0]!.text.match(/\/v1\/sign\/copy\/\S+/)![0];
    const [path, query] = url.split('?');
    expect((await h.call('GET', `${path}?c=forged.claim`)).status).toBe(401);
    expect((await h.call('GET', `${path}?${query}x`)).status).toBe(401);
    expect((await h.call('GET', `/v1/sign/copy/doc_missing?${query}`)).status).toBe(404);
    h.advance(31 * 24 * 60 * 60 * 1000);
    expect((await h.call('GET', url)).status).toBe(401);
  });
});
