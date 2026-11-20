import type { Mailer } from '@codevibe_technology/sign-core';
import { consoleMailer, smtpMailer } from '@codevibe_technology/sign-server';
import type { Env } from './env';
import { GRAPH_MAX_ATTACHMENT_BYTES, graphMailer } from './graph-mail';

type MailConfig = Pick<
  Env,
  'MAIL_TRANSPORT' | 'MAIL_FROM' | 'APP_URL' | 'MS_TENANT_ID' | 'MS_CLIENT_ID' | 'MS_CLIENT_SECRET'
>;

/** What the app needs to build each transport; tests swap these out. */
export interface MailTransports {
  console: () => Mailer;
  smtp: (options: Parameters<typeof smtpMailer>[0]) => Mailer;
  graph: (options: Parameters<typeof graphMailer>[0]) => Mailer;
}

const defaults: MailTransports = { console: consoleMailer, smtp: smtpMailer, graph: graphMailer };

/**
 * The mailer `MAIL_TRANSPORT` asks for: `console` prints, `graph` sends through Microsoft 365,
 * anything else is an SMTP URL.
 */
export function createMailTransport(
  config: MailConfig,
  transports: MailTransports = defaults,
): Mailer {
  if (config.MAIL_TRANSPORT === 'console') return transports.console();
  if (config.MAIL_TRANSPORT === 'graph') {
    return transports.graph({
      tenantId: config.MS_TENANT_ID ?? '',
      clientId: config.MS_CLIENT_ID ?? '',
      clientSecret: config.MS_CLIENT_SECRET ?? '',
      from: config.MAIL_FROM,
    });
  }
  return transports.smtp({
    transport: config.MAIL_TRANSPORT,
    from: config.MAIL_FROM,
    messageIdDomain: new URL(config.APP_URL).hostname,
  });
}

/**
 * Largest total of sealed files attached to the completion email; larger copies go out as
 * download links. Graph takes less per request than most SMTP servers.
 */
export function completedCopyAttachmentLimit(
  config: Pick<Env, 'MAIL_TRANSPORT'>,
  smtpLimit: number,
): number {
  return config.MAIL_TRANSPORT === 'graph'
    ? Math.min(smtpLimit, GRAPH_MAX_ATTACHMENT_BYTES)
    : smtpLimit;
}
