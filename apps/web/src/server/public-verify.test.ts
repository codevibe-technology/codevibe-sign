import { appendEvents, type Envelope } from '@codevibe_technology/sign-core';
import { nodeHasher } from '@codevibe_technology/sign-server';
import { describe, expect, it } from 'vitest';
import { evidenceFrom } from './public-verify';

const envelope: Envelope = {
  id: 'env_1',
  title: 'Offer letter',
  status: 'completed',
  routing: 'sequential',
  documents: [
    { id: 'doc_1', name: 'offer.pdf', sha256: 'a'.repeat(64), pageCount: 1, fileKey: 'k' },
  ],
  recipients: [
    {
      id: 'r1',
      name: 'Asha Rao',
      email: 'asha@example.com',
      role: 'signer',
      order: 1,
      auth: 'email_otp',
      status: 'signed',
      actedAt: '2026-11-20T10:05:00.000Z',
    },
    {
      id: 'r2',
      name: 'Payroll',
      phone: '+919876543210',
      role: 'viewer',
      order: 2,
      auth: 'sms_otp',
      status: 'notified',
    },
  ],
  fields: [],
  values: [],
  reminders: { firstAfterDays: 0, everyDays: 0, max: 0 },
  createdAt: '2026-11-20T09:00:00.000Z',
  sentAt: '2026-11-20T09:01:00.000Z',
  completedAt: '2026-11-20T10:05:00.000Z',
};

async function trail() {
  return appendEvents(
    undefined,
    1,
    [
      { envelopeId: 'env_1', action: 'envelope.sent', at: '2026-11-20T09:01:00.000Z' },
      {
        envelopeId: 'env_1',
        action: 'recipient.signed',
        at: '2026-11-20T10:05:00.000Z',
        recipientId: 'r1',
        context: { ip: '203.0.113.9', userAgent: 'Firefox' },
      },
      { envelopeId: 'env_1', action: 'envelope.completed', at: '2026-11-20T10:05:00.000Z' },
    ],
    nodeHasher,
  );
}

describe('public evidence for a sealed file', () => {
  it('lists the people with masked contacts and the trail with an intact chain', async () => {
    const events = await trail();
    const evidence = await evidenceFrom(
      { ...envelope, auditHead: events.at(-1)!.hash },
      'doc_1',
      events,
    );
    expect(evidence).toMatchObject({ title: 'Offer letter', documentName: 'offer.pdf' });
    expect(evidence.recipients).toEqual([
      expect.objectContaining({
        name: 'Asha Rao',
        contact: 'a****@example.com',
        auth: 'email_otp',
      }),
      expect.objectContaining({ name: 'Payroll', contact: '+91******3210', actedAt: null }),
    ]);
    expect(evidence.events.map((e) => [e.action, e.recipient])).toEqual([
      ['envelope.sent', null],
      ['recipient.signed', 'Asha Rao'],
      ['envelope.completed', null],
    ]);
    expect(evidence.chain).toEqual({ valid: true, head: events.at(-1)!.hash, events: 3 });
    expect(JSON.stringify(evidence)).not.toMatch(/203\.0\.113\.9|Firefox|asha@example/);
  });

  it('reports a broken chain when a step was changed or the log was cut short', async () => {
    const events = await trail();
    const edited = events.map((e) => (e.seq === 2 ? { ...e, at: '2026-11-21T10:05:00.000Z' } : e));
    expect((await evidenceFrom(envelope, 'doc_1', edited)).chain).toEqual({
      valid: false,
      head: null,
      events: 3,
    });
    const cut = await evidenceFrom(
      { ...envelope, auditHead: events.at(-1)!.hash },
      'doc_1',
      events.slice(0, 2),
    );
    expect(cut.chain.valid).toBe(false);
  });
});
