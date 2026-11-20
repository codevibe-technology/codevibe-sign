import { randomUUID } from 'node:crypto';
import type { MailMessage, Mailer, OtpSender, Recipient } from '@codevibe_technology/sign-core';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export interface SmtpMailerOptions {
  /** Passed to `nodemailer.createTransport`. */
  transport: SMTPTransport.Options | string;
  /** Sender address, for example `Codevibe Sign <sign@example.com>`. */
  from: string;
  /**
   * Host name for the `Message-ID` header, for example the app's own host. By default the
   * domain of the sender address.
   */
  messageIdDomain?: string;
}

const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/** A fresh `Message-ID` value, `<uuid@domain>`. */
export function messageId(domain: string): string {
  if (!HOST_NAME.test(domain)) throw new Error(`Invalid Message-ID domain: ${domain}`);
  return `<${randomUUID()}@${domain.toLowerCase()}>`;
}

const addressDomain = (from: string) =>
  (/<([^<>]+)>\s*$/.exec(from)?.[1] ?? from).trim().split('@').pop() ?? 'localhost';

/**
 * The `From` header for a message: the configured address, with the message's `fromName` as
 * the display name when it has one. Quotes, angle brackets and line breaks are dropped from the
 * name so it cannot add an address or a header.
 */
export function fromHeader(from: string, fromName: string | undefined): string {
  const name = fromName?.replace(/[\r\n"<>\\]/g, '').trim();
  if (!name) return from;
  const address = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from.trim();
  return `"${name}" <${address}>`;
}

/** The nodemailer message for a `MailMessage`, sent from `from`. `meta` is never sent. */
export function nodemailerMessage(message: MailMessage, from: string, id?: string) {
  return {
    ...(id ? { messageId: id } : {}),
    from: fromHeader(from, message.fromName),
    to: message.to,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(message.attachments
      ? {
          attachments: message.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content),
            contentType: a.contentType,
          })),
        }
      : {}),
  };
}

export function smtpMailer(options: SmtpMailerOptions): Mailer & { close(): void } {
  const transport = nodemailer.createTransport(options.transport);
  const domain = options.messageIdDomain ?? addressDomain(options.from);
  messageId(domain);
  return {
    async send(message) {
      const id = messageId(domain);
      const info = (await transport.sendMail(nodemailerMessage(message, options.from, id))) as {
        messageId?: string;
      };
      return { messageId: info.messageId ?? id };
    },
    close: () => transport.close(),
  };
}

/** Prints emails instead of sending them, and keeps them in `sent` for tests. */
export function consoleMailer(
  options: { silent?: boolean } = {},
): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      if (!options.silent) {
        console.log(`[mail] to=${message.to} subject=${JSON.stringify(message.subject)}`);
        console.log(message.text);
      }
    },
  };
}

/** Prints one-time codes instead of sending them. Never use it in production. */
export function consoleOtpSender(
  options: { silent?: boolean } = {},
): OtpSender & { sent: { recipient: Recipient; code: string }[] } {
  const sent: { recipient: Recipient; code: string }[] = [];
  return {
    sent,
    async send(recipient, code) {
      sent.push({ recipient, code });
      if (!options.silent) {
        console.log(`[otp] ${recipient.email ?? recipient.phone ?? recipient.id}: ${code}`);
      }
    },
  };
}

/** Sends one-time codes by email. Recipients set to `sms_otp` need an SMS sender instead. */
export function mailOtpSender(mailer: Mailer): OtpSender {
  return {
    async send(recipient, code, context) {
      if (!recipient.email) throw new Error(`Recipient ${recipient.id} has no email address`);
      await mailer.send({
        to: recipient.email,
        meta: {
          kind: 'otp',
          recipientId: recipient.id,
          ...(context?.envelopeId ? { envelopeId: context.envelopeId } : {}),
          ...(context?.workspaceId ? { workspaceId: context.workspaceId } : {}),
        },
        subject: `Your signing code is ${code}`,
        text:
          `Your one-time code is ${code}.\n\nIt expires in 10 minutes. ` +
          'If you did not ask for it, you can ignore this email.',
      });
    },
  };
}
