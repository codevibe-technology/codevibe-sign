import { describe, expect, it } from 'vitest';
import type { WorkspaceMail } from '../templates';
import { API_KEY, envelopeBody, harness, PNG } from '../testing/harness';

const ACME_KEY = 'acme-key-0123456789abcdef';

function setup(workspaceMail: (workspaceId: string) => Promise<WorkspaceMail | null>) {
  const asked: string[] = [];
  const h = harness({
    apiKeys: [API_KEY, { id: 'acme', key: ACME_KEY, workspaceId: 'ws_acme' }],
    workspaceMail: async (workspaceId) => {
      asked.push(workspaceId);
      return workspaceMail(workspaceId);
    },
  });
  const send = (key = ACME_KEY, overrides: Record<string, unknown> = {}) =>
    h.call('POST', '/v1/envelopes', {
      headers: { authorization: `Bearer ${key}` },
      body: envelopeBody({ send: true, ...overrides }),
    });
  return { h, asked, send };
}

const acme: WorkspaceMail = {
  fromName: 'Acme HR',
  replyTo: 'hr@acme.test',
  templates: {
    invite: ({ envelope, recipient, link }) => ({
      subject: `Acme: ${envelope.title}`,
      text: `Hi ${recipient.name} ${link}`,
      html: '<p>Acme</p>',
    }),
  },
};

describe('per-workspace mail', () => {
  it("sends invitations with the workspace's templates and sender details", async () => {
    const { h, asked, send } = setup(async (id) => (id === 'ws_acme' ? acme : null));
    await send();
    const invite = h.mailer.sent.find((m) => m.to === 'asha@example.com');
    expect(invite).toMatchObject({
      subject: 'Acme: Offer letter',
      fromName: 'Acme HR',
      replyTo: 'hr@acme.test',
    });
    expect(invite?.text).toMatch(/\/sign\/[\w-]{43}/);
    expect(asked).toContain('ws_acme');
  });

  it('falls back to the default templates for what the workspace leaves out', async () => {
    const { h, send } = setup(async () => acme);
    const { json: envelope } = await send();
    await h.call('POST', `/v1/envelopes/${envelope.id}/void`, {
      headers: { authorization: `Bearer ${ACME_KEY}` },
      body: { reason: 'Sent by mistake' },
    });
    const cancelled = h.mailer.sent.find((m) => m.subject.startsWith('Cancelled'));
    expect(cancelled).toMatchObject({ fromName: 'Acme HR', replyTo: 'hr@acme.test' });
    expect(cancelled?.subject).toBe(`Cancelled: "${envelope.title}"`);
  });

  it('uses the completed template for the sealed copies', async () => {
    const { h, send } = setup(async () => ({
      templates: {
        completed: ({ envelope, attached }) => ({
          subject: `Done: ${envelope.title}`,
          text: attached ? 'attached' : 'too big',
          html: '<p>done</p>',
        }),
      },
    }));
    const { json: envelope } = await send(ACME_KEY, {
      recipients: [
        { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_link' },
      ],
      fields: [
        { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
      ],
    });
    await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/submit`, {
      body: { consent: true, values: [{ fieldId: envelope.fields[0].id, value: PNG }] },
    });
    const done = h.mailer.sent.find((m) => m.subject.startsWith('Done'));
    expect(done).toMatchObject({ subject: 'Done: Offer letter', text: 'attached' });
    expect(done?.attachments).toHaveLength(2);
    expect(done).not.toHaveProperty('fromName');
  });

  it('leaves other workspaces and a null answer on the defaults', async () => {
    const { h, asked, send } = setup(async (id) => (id === 'ws_acme' ? acme : null));
    await send(API_KEY);
    const invite = h.mailer.sent.find((m) => m.to === 'asha@example.com');
    expect(invite?.subject).toBe('Please sign "Offer letter"');
    expect(invite).not.toHaveProperty('fromName');
    expect(invite).not.toHaveProperty('replyTo');
    expect(asked).toEqual(['default']);
  });
});
