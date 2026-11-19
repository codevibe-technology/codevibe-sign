import type { Envelope, Recipient } from '@codevibe_technology/sign-core';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export interface LinkMailContext {
  envelope: Envelope;
  recipient: Recipient;
  /** The personal signing link. Treat it like a password. */
  link: string;
}

export interface CompletedMailContext {
  envelope: Envelope;
  recipient: Recipient;
  /** False when the sealed files were too large to attach. */
  attached: boolean;
}

export interface MailContext {
  envelope: Envelope;
  recipient: Recipient;
}

export interface MailTemplates {
  invite(ctx: LinkMailContext): RenderedMail;
  reminder(ctx: LinkMailContext): RenderedMail;
  completed(ctx: CompletedMailContext): RenderedMail;
  /** The envelope was declined, voided or expired after this recipient was invited. */
  cancelled(ctx: MailContext): RenderedMail;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(paragraphs: string[], action?: { label: string; href: string }): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  const button = action
    ? `<p><a href="${escapeHtml(action.href)}" style="display:inline-block;padding:10px 18px;` +
      `background:#1f6feb;color:#ffffff;text-decoration:none;border-radius:6px">` +
      `${escapeHtml(action.label)}</a></p>`
    : '';
  return (
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;' +
    `color:#1f2328;max-width:560px">\n${body}\n${button}\n</body></html>`
  );
}

const verb = (recipient: Recipient) => (recipient.role === 'approver' ? 'approve' : 'sign');

function linkMail(ctx: LinkMailContext, reminder: boolean): RenderedMail {
  const { envelope, recipient, link } = ctx;
  const action = verb(recipient);
  const subject = reminder
    ? `Reminder: please ${action} "${envelope.title}"`
    : `Please ${action} "${envelope.title}"`;
  const lines = [
    `Hello ${recipient.name},`,
    reminder
      ? `This is a reminder that "${envelope.title}" is waiting for you to ${action}.`
      : `You have been asked to ${action} "${envelope.title}".`,
    ...(envelope.message ? [envelope.message] : []),
    ...(envelope.expiresAt ? [`The request expires on ${envelope.expiresAt.slice(0, 10)}.`] : []),
    'This link is personal. Do not forward this email.',
  ];
  return {
    subject,
    text: [...lines.slice(0, -1), `Open the document: ${link}`, lines.at(-1)].join('\n\n'),
    html: layout(lines, { label: `Review and ${action}`, href: link }),
  };
}

export const defaultTemplates: MailTemplates = {
  invite: (ctx) => linkMail(ctx, false),
  reminder: (ctx) => linkMail(ctx, true),
  completed({ envelope, recipient, attached }) {
    const lines = [
      `Hello ${recipient.name},`,
      `Everyone has finished with "${envelope.title}".`,
      attached
        ? 'The sealed copy is attached. Keep it for your records.'
        : 'The sealed copy was too large to attach. Ask the sender for a copy.',
    ];
    return {
      subject: `Completed: "${envelope.title}"`,
      text: lines.join('\n\n'),
      html: layout(lines),
    };
  },
  cancelled({ envelope, recipient }) {
    const reason =
      envelope.status === 'declined'
        ? 'was declined'
        : envelope.status === 'expired'
          ? 'has expired'
          : 'was withdrawn by the sender';
    const lines = [
      `Hello ${recipient.name},`,
      `"${envelope.title}" ${reason}. You do not need to do anything, and your link no longer works.`,
    ];
    return {
      subject: `Cancelled: "${envelope.title}"`,
      text: lines.join('\n\n'),
      html: layout(lines),
    };
  },
};
