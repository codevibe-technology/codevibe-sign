import type { MailMessage, Mailer } from '@codevibe_technology/sign-core';
import { describe, expect, it, vi } from 'vitest';
import { copyMailLine, formatBytes, mailKindLabel, mailTime } from '@/lib/mail-log';
import { entryFor, loggingMailer, trimError, type MailLogEntry } from './mail-log';

const copy: MailMessage = {
  to: 'Asha@Example.com',
  subject: 'Completed: "Offer letter"',
  text: 'Download: https://sign.example.com/api/v1/sign/copy/d1?c=secret',
  html: '<a href="https://sign.example.com/api/v1/sign/copy/d1?c=secret">x</a>',
  attachments: [
    { filename: 'a.pdf', content: new Uint8Array(1500), contentType: 'application/pdf' },
  ],
  meta: { kind: 'completed_copy', workspaceId: 'ws_1', envelopeId: 'env_1', recipientId: 'r1' },
};

function setup(send: Mailer['send']) {
  const entries: MailLogEntry[] = [];
  const mailer = loggingMailer({ send }, async (entry) => void entries.push(entry));
  return { entries, mailer };
}

describe('loggingMailer', () => {
  it('records a sent email with its ids, provider message id and attachment size', async () => {
    const { entries, mailer } = setup(async () => ({ messageId: '<m1@sign.example.com>' }));
    expect(await mailer.send(copy)).toEqual({ messageId: '<m1@sign.example.com>' });
    expect(entries).toEqual([
      {
        workspaceId: 'ws_1',
        envelopeId: 'env_1',
        recipientId: 'r1',
        kind: 'completed_copy',
        recipientEmail: 'asha@example.com',
        subject: 'Completed: "Offer letter"',
        providerMessageId: '<m1@sign.example.com>',
        status: 'sent',
        error: null,
        attachmentCount: 1,
        attachmentBytes: 1500,
      },
    ]);
  });

  it('never keeps the body or links', async () => {
    const { entries, mailer } = setup(async () => {});
    await mailer.send(copy);
    expect(JSON.stringify(entries)).not.toMatch(/secret|copy\/d1|Download/);
  });

  it('records a failed send with the SMTP error and still throws it', async () => {
    const { entries, mailer } = setup(async () => {
      throw new Error('552 5.3.4 Message size exceeds fixed limit');
    });
    await expect(mailer.send(copy)).rejects.toThrow('552');
    expect(entries[0]).toMatchObject({
      status: 'failed',
      error: '552 5.3.4 Message size exceeds fixed limit',
      providerMessageId: null,
    });
  });

  it('keeps sending when the log cannot be written', async () => {
    const report = vi.fn();
    const mailer = loggingMailer(
      { send: async () => ({ messageId: '<m@x>' }) },
      async () => {
        throw new Error('database down');
      },
      report,
    );
    await expect(mailer.send(copy)).resolves.toEqual({ messageId: '<m@x>' });
    expect(report).toHaveBeenCalledOnce();
  });

  it('hides the one-time code from the subject', () => {
    const entry = entryFor(
      {
        to: 'a@x.test',
        subject: 'Your signing code is 123456',
        text: '123456',
        meta: { kind: 'otp' },
      },
      {},
    );
    expect(entry.subject).toBe('Your signing code');
    expect(JSON.stringify(entry)).not.toContain('123456');
  });

  it('labels mail without meta as other, with no workspace', () => {
    expect(entryFor({ to: 'a@x.test', subject: 'Hi', text: 'Hi' }, {})).toMatchObject({
      kind: 'other',
      workspaceId: null,
      attachmentCount: 0,
      attachmentBytes: 0,
    });
  });
});

describe('trimError', () => {
  it('shortens to one line and drops links', () => {
    const text = trimError(
      new Error(`550 rejected\n  see https://x.test/sign/abc?token=1 ${'x'.repeat(400)}`),
    );
    expect(text).not.toContain('\n');
    expect(text).not.toContain('https://');
    expect(text).toContain('[link]');
    expect(text.length).toBeLessThanOrEqual(300);
    expect(trimError('')).toBe('Unknown error');
  });
});

describe('mail log display', () => {
  const now = new Date(2026, 10, 20, 18, 0);

  it('shows the time for today and the date otherwise', () => {
    expect(mailTime(new Date(2026, 10, 20, 14, 42).toISOString(), now)).toBe('14:42');
    expect(mailTime(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe('3 Nov, 09:05');
  });

  it('says whether the copy went out', () => {
    const at = new Date(2026, 10, 20, 14, 42).toISOString();
    expect(copyMailLine({ status: 'sent', at, error: null }, now)).toBe('Copy emailed 14:42');
    expect(copyMailLine({ status: 'failed', at, error: '550 mailbox unavailable' }, now)).toBe(
      'Email failed: 550 mailbox unavailable',
    );
  });

  it('labels kinds and sizes', () => {
    expect(mailKindLabel('completed_copy')).toBe('Completed copy');
    expect(mailKindLabel('weird')).toBe('Other');
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(1500)).toBe('1 KB');
    expect(formatBytes(6 * 1024 * 1024)).toBe('6.0 MB');
  });
});
