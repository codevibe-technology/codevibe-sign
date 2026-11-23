import { describe, expect, it } from 'vitest';
import type { EnvelopeChange } from '../options';
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

describe('onEnvelopeChange', () => {
  it('reports every saved change with its workspace, envelope and audit actions', async () => {
    const changes: EnvelopeChange[] = [];
    const h = harness({ onEnvelopeChange: (change) => void changes.push(change) });
    const envelope = await complete(h);
    expect(changes.every((c) => c.workspaceId === 'default' && c.envelopeId === envelope.id)).toBe(
      true,
    );
    const actions = changes.flatMap((c) => c.actions);
    expect(actions).toEqual(
      expect.arrayContaining([
        'envelope.created',
        'envelope.sent',
        'recipient.signed',
        'envelope.completed',
        'document.sealed',
      ]),
    );
  });

  it('keeps the change when the hook throws', async () => {
    const h = harness({
      onEnvelopeChange: () => {
        throw new Error('listener down');
      },
    });
    const envelope = await complete(h);
    const { json } = await h.call('GET', `/v1/envelopes/${envelope.id}`);
    expect(json.status).toBe('completed');
    expect(h.logs.some((l) => l.message === 'onEnvelopeChange failed')).toBe(true);
  });

  it('carries only identifiers and action names', async () => {
    const changes: EnvelopeChange[] = [];
    const h = harness({ onEnvelopeChange: (change) => void changes.push(change) });
    await complete(h);
    for (const change of changes) {
      expect(Object.keys(change).sort()).toEqual(['actions', 'envelopeId', 'workspaceId']);
      expect(JSON.stringify(change)).not.toMatch(/asha|Asha|Offer letter/);
    }
  });
});

describe('mail meta', () => {
  it('labels every envelope email with its kind, workspace, envelope and recipient', async () => {
    const h = harness();
    const envelope = await complete(h);
    const kinds = h.mailer.sent.map((m) => m.meta?.kind);
    expect(kinds).toEqual(['invite', 'completed_copy']);
    for (const mail of h.mailer.sent) {
      expect(mail.meta).toMatchObject({ workspaceId: 'default', envelopeId: envelope.id });
      expect(mail.meta?.recipientId).toEqual(expect.any(String));
    }
  });
});
