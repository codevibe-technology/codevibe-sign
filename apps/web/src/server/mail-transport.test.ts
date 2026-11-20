import type { Mailer } from '@codevibe_technology/sign-core';
import { describe, expect, it, vi } from 'vitest';
import { GRAPH_MAX_ATTACHMENT_BYTES } from './graph-mail';
import {
  completedCopyAttachmentLimit,
  createMailTransport,
  type MailTransports,
} from './mail-transport';

const base = {
  MAIL_FROM: 'Codevibe <no-reply@codevibe.in>',
  APP_URL: 'https://sign.example.com',
  MS_TENANT_ID: undefined,
  MS_CLIENT_ID: undefined,
  MS_CLIENT_SECRET: undefined,
};

function fakes() {
  const mailer = (name: string): Mailer => ({ send: async () => ({ messageId: name }) });
  return {
    console: vi.fn(() => mailer('console')),
    smtp: vi.fn(() => mailer('smtp')),
    graph: vi.fn(() => mailer('graph')),
  } satisfies MailTransports;
}

describe('createMailTransport', () => {
  it('prints mail for console', () => {
    const t = fakes();
    createMailTransport({ ...base, MAIL_TRANSPORT: 'console' }, t);
    expect(t.console).toHaveBeenCalledOnce();
    expect(t.smtp).not.toHaveBeenCalled();
    expect(t.graph).not.toHaveBeenCalled();
  });

  it('sends through Microsoft Graph for graph', () => {
    const t = fakes();
    createMailTransport(
      {
        ...base,
        MAIL_TRANSPORT: 'graph',
        MS_TENANT_ID: 'tenant',
        MS_CLIENT_ID: 'client',
        MS_CLIENT_SECRET: 'secret',
      },
      t,
    );
    expect(t.graph).toHaveBeenCalledWith({
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      from: 'Codevibe <no-reply@codevibe.in>',
    });
    expect(t.smtp).not.toHaveBeenCalled();
  });

  it('treats anything else as an SMTP URL, as before', () => {
    const t = fakes();
    createMailTransport({ ...base, MAIL_TRANSPORT: 'smtps://u:p@smtp.example.com:465' }, t);
    expect(t.smtp).toHaveBeenCalledWith({
      transport: 'smtps://u:p@smtp.example.com:465',
      from: 'Codevibe <no-reply@codevibe.in>',
      messageIdDomain: 'sign.example.com',
    });
    expect(t.graph).not.toHaveBeenCalled();
  });
});

describe('completedCopyAttachmentLimit', () => {
  const five = 5 * 1024 * 1024;

  it('keeps the SMTP limit for SMTP and console', () => {
    expect(completedCopyAttachmentLimit({ MAIL_TRANSPORT: 'smtp://x' }, five)).toBe(five);
    expect(completedCopyAttachmentLimit({ MAIL_TRANSPORT: 'console' }, five)).toBe(five);
  });

  it('lowers it for Graph so larger copies go out as links', () => {
    expect(completedCopyAttachmentLimit({ MAIL_TRANSPORT: 'graph' }, five)).toBe(
      GRAPH_MAX_ATTACHMENT_BYTES,
    );
    expect(completedCopyAttachmentLimit({ MAIL_TRANSPORT: 'graph' }, 1024)).toBe(1024);
  });
});
