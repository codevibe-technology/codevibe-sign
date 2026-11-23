import type { Envelope, Recipient } from '@codevibe_technology/sign-core';
import { formatMailDate } from './time-zone';

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
  /** IANA zone for the dates in the text: the workspace's, or the server's. UTC when absent. */
  timeZone?: string;
}

/** A link to download one sealed document. Personal to the recipient, like a signing link. */
export interface CopyDownload {
  name: string;
  url: string;
}

export interface CompletedMailContext {
  envelope: Envelope;
  recipient: Recipient;
  /** False when the sealed files are not attached: too large, unreadable or refused. */
  attached: boolean;
  /**
   * The envelope's audit trail is sent too: attached as a PDF of its own when `attached`,
   * otherwise as one of the `downloads`. Absent means false.
   */
  auditTrail?: boolean;
  /** When not attached, a download link for each sealed file. Empty otherwise. */
  downloads: CopyDownload[];
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

/** How one workspace's emails read and whom they appear to come from. */
export interface WorkspaceMail {
  /** Replace some or all templates; the server's templates fill in the rest. */
  templates?: Partial<MailTemplates>;
  /** Display name on the `From` header. The address stays the mailer's own. */
  fromName?: string;
  replyTo?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(
  paragraphs: string[],
  action?: { label: string; href: string },
  links: CopyDownload[] = [],
): string {
  const list = links.length
    ? `<ul>${links
        .map((l) => `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.name)}</a></li>`)
        .join('')}</ul>`
    : '';
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n') + list;
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
  const { envelope, recipient, link, timeZone } = ctx;
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
    ...(envelope.changeNote ? [`What changed: ${envelope.changeNote}`] : []),
    ...(envelope.expiresAt
      ? [`The request expires on ${formatMailDate(envelope.expiresAt, timeZone)}.`]
      : []),
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
  completed({ envelope, recipient, attached, auditTrail, downloads }) {
    const lines = [
      `Hello ${recipient.name},`,
      `Everyone has finished with "${envelope.title}".`,
      attached
        ? auditTrail
          ? 'The signed copy and its audit trail are attached. Keep them for your records.'
          : 'The sealed copy is attached. Keep it for your records.'
        : downloads.length
          ? auditTrail
            ? 'The signed copy and its audit trail could not be attached. Download them here and keep them for your records. The links are personal and work for 30 days.'
            : 'The sealed copy could not be attached. Download it here and keep it for your records. The link is personal and works for 30 days.'
          : 'The sealed copy could not be attached. Ask the sender for a copy.',
    ];
    const text = [...lines, ...downloads.map((d) => `${d.name}: ${d.url}`)].join('\n\n');
    return {
      subject: `Completed: "${envelope.title}"`,
      text,
      html: layout(lines, undefined, attached ? [] : downloads),
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
