import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultTemplates } from '../templates';
import { localFileStore } from './files';
import {
  consoleMailer,
  fromHeader,
  mailOtpSender,
  messageId,
  nodemailerMessage,
  smtpMailer,
} from './mail';

describe('localFileStore', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('writes, reads and deletes nested keys', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sign-files-'));
    const files = localFileStore(dir);
    await files.put(
      'envelopes/e1/documents/0/original.pdf',
      new Uint8Array([1, 2]),
      'application/pdf',
    );
    expect(await files.get('envelopes/e1/documents/0/original.pdf')).toEqual(
      new Uint8Array([1, 2]),
    );
    await files.delete('envelopes/e1/documents/0/original.pdf');
    expect(await files.get('envelopes/e1/documents/0/original.pdf')).toBeNull();
    await files.delete('missing');
  });

  it('refuses keys that could leave the directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sign-files-'));
    const files = localFileStore(dir);
    for (const key of ['../x', 'a/../../x', '/etc/passwd', 'a//b', '', 'a/./b']) {
      await expect(files.put(key, new Uint8Array(), 'text/plain')).rejects.toThrow(/Unsafe/);
    }
  });
});

describe('mail', () => {
  it('uses the display name but keeps the configured address', () => {
    expect(fromHeader('Codevibe Sign <sign@example.com>', 'Acme HR')).toBe(
      '"Acme HR" <sign@example.com>',
    );
    expect(fromHeader('sign@example.com', 'Acme')).toBe('"Acme" <sign@example.com>');
    expect(fromHeader('Codevibe Sign <sign@example.com>', undefined)).toBe(
      'Codevibe Sign <sign@example.com>',
    );
    expect(fromHeader('Codevibe Sign <sign@example.com>', '  ')).toBe(
      'Codevibe Sign <sign@example.com>',
    );
  });

  it('drops characters that could add an address or a header to the name', () => {
    expect(fromHeader('sign@example.com', 'Evil" <x@evil.test>\r\nBcc: y@evil.test')).toBe(
      '"Evil x@evil.testBcc: y@evil.test" <sign@example.com>',
    );
  });

  it('passes reply-to through and leaves it out when unset', () => {
    const base = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };
    expect(nodemailerMessage({ ...base, replyTo: 'hr@acme.test' }, 'sign@x.test')).toMatchObject({
      from: 'sign@x.test',
      replyTo: 'hr@acme.test',
    });
    expect(nodemailerMessage(base, 'sign@x.test')).not.toHaveProperty('replyTo');
  });

  it('sends OTP codes by email', async () => {
    const mailer = consoleMailer({ silent: true });
    await mailOtpSender(mailer).send(
      {
        id: 'r',
        name: 'A',
        email: 'a@example.com',
        role: 'signer',
        order: 1,
        auth: 'email_otp',
        status: 'notified',
      },
      '123456',
      { envelopeId: 'env_1', workspaceId: 'ws_1' },
    );
    expect(mailer.sent[0]).toMatchObject({
      to: 'a@example.com',
      subject: 'Your signing code is 123456',
      meta: { kind: 'otp', envelopeId: 'env_1', workspaceId: 'ws_1', recipientId: 'r' },
    });
  });

  it('never puts the log meta into the sent message', () => {
    const message = nodemailerMessage(
      { to: 'a@x.test', subject: 'S', text: 'T', meta: { kind: 'invite' } },
      'sign@x.test',
      '<id@sign.x.test>',
    );
    expect(message).not.toHaveProperty('meta');
    expect(message.messageId).toBe('<id@sign.x.test>');
  });

  it('makes Message-IDs on the given host and refuses a malformed one', () => {
    expect(messageId('Sign.Example.com')).toMatch(/^<[0-9a-f-]{36}@sign\.example\.com>$/);
    expect(() => messageId('bad host>')).toThrow(/Message-ID domain/);
  });

  it('sends with a Message-ID on the configured host and returns it', async () => {
    const mailer = smtpMailer({
      transport: { jsonTransport: true } as never,
      from: 'Sign <sign@mail.example.com>',
      messageIdDomain: 'sign.example.com',
    });
    const receipt = await mailer.send({
      to: 'a@x.test',
      subject: 'S',
      text: 'T',
      html: '<p>T</p>',
    });
    expect(receipt?.messageId).toMatch(/@sign\.example\.com>$/);
    const fallback = smtpMailer({
      transport: { jsonTransport: true } as never,
      from: 'sign@mail.example.com',
    });
    expect((await fallback.send({ to: 'a@x.test', subject: 'S', text: 'T' }))?.messageId).toMatch(
      /@mail\.example\.com>$/,
    );
  });

  it('escapes names and titles in HTML', () => {
    const mail = defaultTemplates.invite({
      envelope: {
        id: 'e',
        title: '<script>x</script>',
        status: 'sent',
        routing: 'parallel',
        documents: [],
        recipients: [],
        fields: [],
        values: [],
        reminders: { firstAfterDays: 0, everyDays: 1, max: 0 },
        createdAt: '2026-01-01T00:00:00Z',
      },
      recipient: {
        id: 'r',
        name: 'A & B',
        role: 'approver',
        order: 1,
        auth: 'email_link',
        status: 'notified',
      },
      link: 'https://sign.example.com/sign/abc?x="y"',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('A &amp; B');
    expect(mail.html).toContain('&quot;y&quot;');
    expect(mail.subject).toBe('Please approve "<script>x</script>"');
    expect(mail.text).toContain('https://sign.example.com/sign/abc');
  });
});
