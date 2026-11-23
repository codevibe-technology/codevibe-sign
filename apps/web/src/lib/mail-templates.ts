import { DEFAULT_BRAND_COLOR, isHexColor, textOn } from './brand';
import { formatDateTime } from './envelopes';

/**
 * The emails recipients get about an envelope, in a workspace's brand. Pure, so the settings
 * page previews exactly what the server sends.
 */
export const MAIL_KINDS = ['invite', 'reminder', 'completed', 'cancelled'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export const MAIL_KIND_LABELS: Record<MailKind, string> = {
  invite: 'Invitation',
  reminder: 'Reminder',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export interface MailOverride {
  subject?: string;
  intro?: string;
}
export type MailOverrides = Partial<Record<MailKind, MailOverride>>;

export const SUBJECT_MAX = 150;
export const INTRO_MAX = 1000;

export const MAIL_VARIABLES = {
  recipient_name: 'Name of the person the email goes to',
  document_title: 'Title of the envelope',
  company: 'Your sender name, or the workspace name',
  action: '"sign" or "approve"',
  expires_on: 'When the request expires, in the workspace time zone, or empty',
  status: 'Why it was cancelled: "was declined", "has expired" or "was withdrawn"',
} as const;
export type MailVariable = keyof typeof MAIL_VARIABLES;

/** Which variables make sense in each email. */
export const KIND_VARIABLES: Record<MailKind, MailVariable[]> = {
  invite: ['recipient_name', 'document_title', 'company', 'action', 'expires_on'],
  reminder: ['recipient_name', 'document_title', 'company', 'action', 'expires_on'],
  completed: ['recipient_name', 'document_title', 'company'],
  cancelled: ['recipient_name', 'document_title', 'company', 'status'],
};

export const DEFAULT_MAIL_TEXT: Record<MailKind, Required<MailOverride>> = {
  invite: {
    subject: 'Please {{action}} "{{document_title}}"',
    intro: '{{company}} has asked you to {{action}} "{{document_title}}".',
  },
  reminder: {
    subject: 'Reminder: please {{action}} "{{document_title}}"',
    intro: 'This is a reminder that "{{document_title}}" is waiting for you to {{action}}.',
  },
  completed: {
    subject: 'Completed: "{{document_title}}"',
    intro: 'Everyone has finished with "{{document_title}}".',
  },
  cancelled: {
    subject: 'Cancelled: "{{document_title}}"',
    intro: '"{{document_title}}" {{status}}. You do not need to do anything.',
  },
};

const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Variables a template names that this email does not offer. */
export function unknownVariables(kind: MailKind, template: string): string[] {
  const allowed = new Set<string>(KIND_VARIABLES[kind]);
  return [...template.matchAll(VARIABLE)].map((m) => m[1]!).filter((name) => !allowed.has(name));
}

export function fillVariables(
  template: string,
  values: Partial<Record<MailVariable, string>>,
): string {
  return template.replace(VARIABLE, (whole, name: string) =>
    name in values ? (values[name as MailVariable] ?? '') : whole,
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface MailBrand {
  /** Sender name or workspace name. */
  company: string;
  brandColor: string;
  /** Absolute URL, since mail clients have no base URL. */
  logoUrl: string | null;
  showBadge: boolean;
}

export interface MailInput {
  recipientName: string;
  title: string;
  role: 'signer' | 'approver' | 'viewer';
  /** The sender's own message on the envelope. */
  message?: string | null;
  /** A revised envelope: what changed since the declined version. */
  changeNote?: string | null;
  expiresAt?: string | null;
  /** IANA zone the expiry is written in, with the zone named. UTC when absent. */
  timeZone?: string;
  /** Invitations and reminders: the personal signing link. */
  link?: string;
  /** Completed: the sealed files are attached. */
  attached?: boolean;
  /** Completed without attachments: a personal download link per sealed document. */
  downloads?: { name: string; url: string }[];
  /** Cancelled: what happened to the envelope. */
  envelopeStatus?: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const statusText = (status: string | undefined) =>
  status === 'declined' ? 'was declined' : status === 'expired' ? 'has expired' : 'was withdrawn';

/** One email in the workspace's brand, with its overrides applied. */
export function renderMail(
  kind: MailKind,
  input: MailInput,
  brand: MailBrand,
  override: MailOverride = {},
): RenderedMail {
  const action = input.role === 'approver' ? 'approve' : 'sign';
  const values: Record<MailVariable, string> = {
    recipient_name: input.recipientName,
    document_title: input.title,
    company: brand.company,
    action,
    expires_on: input.expiresAt ? formatDateTime(input.expiresAt, input.timeZone ?? 'UTC') : '',
    status: statusText(input.envelopeStatus),
  };
  const pick = (part: keyof MailOverride) =>
    override[part]?.trim() ? override[part]!.trim() : DEFAULT_MAIL_TEXT[kind][part];
  const subject = fillVariables(pick('subject'), values)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const intro = fillVariables(pick('intro'), values);

  const paragraphs = [`Hello ${input.recipientName},`, ...intro.split(/\n{2,}/)];
  const linkMail = kind === 'invite' || kind === 'reminder';
  if (linkMail && input.message) paragraphs.push(input.message);
  if (linkMail && input.changeNote) paragraphs.push(`What changed: ${input.changeNote}`);
  if (linkMail && values.expires_on) {
    paragraphs.push(`The request expires on ${values.expires_on}.`);
  }
  const downloads = kind === 'completed' && !input.attached ? (input.downloads ?? []) : [];
  if (kind === 'completed') {
    paragraphs.push(
      input.attached
        ? 'The signed copy is attached. Keep it for your records.'
        : downloads.length
          ? 'The signed copy could not be attached. Download it below and keep it for your records.'
          : `The signed copy could not be attached. Ask ${brand.company} for a copy.`,
    );
  }
  if (kind === 'cancelled') paragraphs.push('Your signing link no longer works.');
  const single = downloads.length === 1 ? downloads[0] : undefined;
  const button =
    linkMail && input.link
      ? { label: `Review and ${action}`, href: input.link }
      : single
        ? { label: 'Download the signed copy', href: single.url }
        : null;
  const links = single ? [] : downloads;
  const after = linkMail
    ? ['This link is personal. Do not forward this email.']
    : downloads.length
      ? ['The download link is personal and works for 30 days. Do not forward this email.']
      : [];

  const footer = `Sent by ${brand.company}${brand.showBadge ? ' · Secured by Codevibe Sign' : ''}`;
  const text = [
    ...paragraphs,
    ...(button ? [`${button.label}: ${button.href}`] : []),
    ...links.map((l) => `${l.name}: ${l.url}`),
    ...after,
    footer,
  ].join('\n\n');
  return { subject, text, html: layout(brand, paragraphs, button, after, footer, links) };
}

function layout(
  brand: MailBrand,
  paragraphs: string[],
  button: { label: string; href: string } | null,
  after: string[],
  footer: string,
  links: { name: string; url: string }[] = [],
): string {
  const color = isHexColor(brand.brandColor) ? brand.brandColor : DEFAULT_BRAND_COLOR;
  const ink = textOn(color);
  const para = (text: string) =>
    `<p style="margin:0 0 12px">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.company)}" height="32" style="height:32px;max-width:160px;background:#FFFFFF;border-radius:4px;padding:2px">`
    : `<span style="font-weight:700;font-size:17px">${escapeHtml(brand.company)}</span>`;
  const action = button
    ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:${color};color:${ink};text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>` +
      `<p style="margin:12px 0 0;font-size:13px;color:#5B6B80">Or paste this link into your browser:<br>${escapeHtml(button.href)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Inter,Arial,sans-serif;color:#0D1B2A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#FFFFFF;border:1px solid #D9E0EA;border-radius:12px;overflow:hidden">
<tr><td style="padding:16px 28px;background:${color};color:${ink}">${header}</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.6">
${paragraphs.map(para).join('\n')}
${links.map((l) => `<p style="margin:0 0 8px"><a href="${escapeHtml(l.url)}" style="color:${color};font-weight:600">${escapeHtml(l.name)}</a></p>`).join('')}
${action}
${after.map((line) => `<p style="margin:16px 0 0;font-size:13px;color:#5B6B80">${escapeHtml(line)}</p>`).join('')}
</td></tr>
<tr><td style="padding:12px 28px;border-top:1px solid #D9E0EA;font-size:12px;color:#5B6B80">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** A sample of each email for the settings preview. */
export function sampleInput(kind: MailKind): MailInput {
  return {
    recipientName: 'Ravi Kumar',
    title: 'Offer letter',
    role: 'signer',
    message:
      kind === 'invite' ? 'Please sign by Friday so we can confirm your joining date.' : null,
    expiresAt: kind === 'invite' || kind === 'reminder' ? '2026-12-31T00:00:00.000Z' : null,
    link: 'https://sign.example.com/api/sign/your-personal-link',
    attached: true,
    envelopeStatus: 'voided',
  };
}

/** To the member who sent an envelope: someone declined it, with their reason in full. */
export function declineNotice(input: {
  senderName: string;
  title: string;
  declinedBy: string;
  role: 'signer' | 'approver' | 'viewer';
  reason: string | null;
  url: string;
}): RenderedMail {
  const role = input.role === 'approver' ? 'approver' : 'signer';
  const paragraphs = [
    `Hello ${input.senderName || 'there'},`,
    `${input.declinedBy} (${role}) declined “${input.title}”.`,
    input.reason ? `Their reason: ${input.reason}` : 'They did not give a reason.',
    'You can revise it and send it again from the envelope page. Everyone signs the new version.',
  ];
  const button = { label: 'Open the envelope', href: input.url };
  const footer = 'Sent by Codevibe Sign';
  const brand: MailBrand = {
    company: 'Codevibe Sign',
    brandColor: DEFAULT_BRAND_COLOR,
    logoUrl: null,
    showBadge: false,
  };
  return {
    subject: `Declined: ${input.title}`.replace(/[\r\n]+/g, ' '),
    text: [...paragraphs, `${button.label}: ${button.href}`, footer].join('\n\n'),
    html: layout(brand, paragraphs, button, [], footer),
  };
}
