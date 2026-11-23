import type { Envelope, Recipient } from '@codevibe_technology/sign-core';
import { describe, expect, it } from 'vitest';
import type { Brand } from '../brand';
import { createWorkspaceMail } from './mail';

const brand: Brand = {
  workspaceId: 'ws_1',
  logoUrl: '/brand/ws_1/logo?v=1',
  logoWide: false,
  brandColor: '#0F766E',
  font: 'inter',
  senderName: null,
  replyTo: 'hr@acme.test',
  emailOverrides: { invite: { subject: '{{company}} needs your signature' } },
  signingDomain: null,
  signingDomainVerified: false,
  certificateFooter: null,
  showBadge: false,
};

const envelope = {
  id: 'e1',
  title: 'Offer <letter>',
  status: 'voided',
  message: 'See you soon',
} as Envelope;
const recipient = { id: 'r1', name: 'Ravi', role: 'signer' } as Recipient;

const mailFor = (overrides: Partial<Brand> = {}, name: string | null = 'Acme') =>
  createWorkspaceMail({
    appUrl: 'https://sign.example.com',
    brand: async () => ({ ...brand, ...overrides }),
    workspaceName: async () => name,
  });

describe('createWorkspaceMail', () => {
  it('sends as the workspace with its reply-to, logo and overrides', async () => {
    const mail = await mailFor()('ws_1');
    expect(mail).toMatchObject({ fromName: 'Acme', replyTo: 'hr@acme.test' });
    const invite = mail!.templates!.invite!({ envelope, recipient, link: 'https://l.test/x' });
    expect(invite.subject).toBe('Acme needs your signature');
    expect(invite.html).toContain('src="https://sign.example.com/brand/ws_1/logo?v=1"');
    expect(invite.html).toContain('Offer &lt;letter&gt;');
    expect(invite.text).toContain('See you soon');
    expect(invite.text).not.toContain('Codevibe Sign');
  });

  it('prefers the sender name and fills every kind', async () => {
    const mail = await mailFor({ senderName: 'Acme People', replyTo: null })('ws_1');
    expect(mail?.fromName).toBe('Acme People');
    expect(mail).not.toHaveProperty('replyTo');
    const templates = mail!.templates!;
    expect(templates.reminder!({ envelope, recipient, link: 'x' }).subject).toMatch(/^Reminder/);
    expect(
      templates.completed!({ envelope, recipient, attached: false, downloads: [] }).text,
    ).toContain('Ask Acme People for a copy');
    const linked = templates.completed!({
      envelope,
      recipient,
      attached: false,
      downloads: [{ name: 'offer.pdf', url: 'https://sign.example.com/api/v1/sign/copy/d1?c=x' }],
    });
    expect(linked.text).toContain(
      'Download the signed copy: https://sign.example.com/api/v1/sign/copy/d1?c=x',
    );
    expect(linked.html).toContain('href="https://sign.example.com/api/v1/sign/copy/d1?c=x"');
    expect(linked.text).toContain('works for 30 days');
    expect(templates.cancelled!({ envelope, recipient }).text).toContain('was withdrawn');
  });

  it('leaves workspaces it does not know on the defaults', async () => {
    expect(await mailFor({}, null)('default')).toBeNull();
  });
});
