import type { Mailer } from '@codevibe_technology/sign-core';
import { describe, expect, it } from 'vitest';
import { sendInvitation } from './mail';

type Sent = Parameters<Mailer['send']>[0];

async function invitation(inviterName: string): Promise<Sent> {
  const sent: Sent[] = [];
  const mailer = { send: async (mail: Sent) => void sent.push(mail) } as unknown as Mailer;
  await sendInvitation(mailer, {
    to: 'ravi@example.com',
    url: 'https://sign.example.com/invite/token',
    workspaceId: 'ws_1',
    workspaceName: 'Acme HR',
    inviterName,
    role: 'member',
  });
  return sent[0]!;
}

describe('sendInvitation', () => {
  it('says who invited the person, by name', async () => {
    const mail = await invitation('Asha Rao');
    expect(mail.subject).toBe('Asha Rao invited you to Acme HR');
    expect(mail.text).toContain('Asha Rao invited you to the Acme HR workspace as member.');
    expect(mail.html).toContain('Asha Rao invited you to the Acme HR workspace');
  });

  it('escapes a name that looks like markup in the HTML part', async () => {
    const mail = await invitation('<img src=x onerror=alert(1)> & "Co"');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;');
    expect(mail.text).toContain('<img src=x onerror=alert(1)> & "Co" invited you');
  });
});
