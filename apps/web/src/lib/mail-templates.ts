import { escapeHtml, renderEmail, standardLinks } from './email-layout';
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
    subject: '{{company}} asked you to {{action}} "{{document_title}}"',
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

export { escapeHtml };

export interface MailBrand {
  /** Sender name or workspace name. */
  company: string;
  brandColor: string;
  /** Absolute URL, since mail clients have no base URL. */
  logoUrl: string | null;
  showBadge: boolean;
  /** The public URL of the app: the Codevibe Sign logo and the footer links come from it. */
  appUrl: string;
  /** Who runs this install and where, for the footer. Shown only with the badge. */
  org?: string | null;
}

export interface MailInput {
  recipientName: string;
  title: string;
  role: 'signer' | 'approver' | 'viewer';
  /** The recipient signs with Aadhaar eSign rather than drawing a signature. */
  aadhaar?: boolean;
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
  /** Completed: the audit trail goes with them, attached or as a download. */
  auditTrail?: boolean;
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

const AADHAAR_NOTE =
  'You sign with Aadhaar eSign. Keep your Aadhaar number and the mobile phone linked to it at hand: UIDAI sends a one-time code to that phone.';

function heading(kind: MailKind, input: MailInput, action: string): string {
  const how = input.aadhaar && action === 'sign' ? ' with Aadhaar eSign' : '';
  switch (kind) {
    case 'invite':
      return `You have a document to ${action}${how}`;
    case 'reminder':
      return `A document is waiting for you to ${action}${how}`;
    case 'completed':
      return 'The document is complete';
    case 'cancelled':
      return input.envelopeStatus === 'declined'
        ? 'The document was declined'
        : input.envelopeStatus === 'expired'
          ? 'The signing request has expired'
          : 'The signing request was withdrawn';
  }
}

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
  const aadhaar = linkMail && input.aadhaar === true && action === 'sign';
  if (aadhaar) paragraphs.push(AADHAAR_NOTE);
  if (linkMail && input.changeNote) paragraphs.push(`What changed: ${input.changeNote}`);
  const downloads = kind === 'completed' && !input.attached ? (input.downloads ?? []) : [];
  if (kind === 'completed') {
    paragraphs.push(
      input.attached
        ? input.auditTrail
          ? 'The signed copy and its audit trail are attached. Keep them for your records.'
          : 'The signed copy is attached. Keep it for your records.'
        : downloads.length
          ? input.auditTrail
            ? 'The signed copy and its audit trail could not be attached. Download them below and keep them for your records.'
            : 'The signed copy could not be attached. Download it below and keep it for your records.'
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
        : undefined;
  const notes = linkMail
    ? ['This link is personal. Do not forward this email.']
    : downloads.length
      ? ['The download link is personal and works for 30 days. Do not forward this email.']
      : [];

  const details = [
    { label: 'Document', value: input.title },
    { label: 'From', value: brand.company },
    ...(linkMail && input.role === 'approver' ? [{ label: 'Your part', value: 'Approver' }] : []),
    ...(aadhaar ? [{ label: 'Signing method', value: 'Aadhaar eSign' }] : []),
    ...(linkMail && values.expires_on ? [{ label: 'Expires', value: values.expires_on }] : []),
  ];
  const why =
    kind === 'completed'
      ? `You got this email because you took part in "${input.title}".`
      : kind === 'cancelled'
        ? `You got this email because ${brand.company} asked you to ${action} "${input.title}".`
        : `You got this email because ${brand.company} sent you a document to ${action}${brand.showBadge ? ' with Codevibe Sign' : ''}.`;
  const body = renderEmail({
    appUrl: brand.appUrl,
    preheader: linkMail
      ? `${brand.company}: "${input.title}" is waiting for you to ${action}.`
      : intro.split(/\n/)[0]!,
    header: brand.logoUrl
      ? { kind: 'logo', src: brand.logoUrl, alt: brand.company }
      : brand.showBadge
        ? { kind: 'codevibe' }
        : { kind: 'name', name: brand.company },
    heading: heading(kind, input, action),
    paragraphs,
    ...(linkMail && input.message
      ? { quote: { label: `Message from ${brand.company}`, text: input.message } }
      : {}),
    links: single ? [] : downloads,
    details,
    ...(button ? { button } : {}),
    notes,
    color: brand.brandColor,
    footer: {
      reason: why,
      lines: brand.showBadge
        ? [
            'Sent with Codevibe Sign · Signing certificate provided by Codevibe Sign',
            ...(brand.org ? [brand.org] : []),
          ]
        : [],
      links: [
        { label: 'Verify a signed document', href: `${brand.appUrl}/verify` },
        ...(brand.showBadge ? standardLinks(brand.appUrl) : []),
      ],
    },
  });
  return { subject, ...body };
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
    auditTrail: true,
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
  appUrl: string;
  org?: string | null;
}): RenderedMail {
  const role = input.role === 'approver' ? 'approver' : 'signer';
  const body = renderEmail({
    appUrl: input.appUrl,
    preheader: `${input.declinedBy} declined "${input.title}".`,
    header: { kind: 'codevibe' },
    heading: `${input.declinedBy} declined “${input.title}”`,
    paragraphs: [
      `Hello ${input.senderName || 'there'},`,
      `${input.declinedBy} (${role}) declined “${input.title}”.`,
      ...(input.reason ? [] : ['They did not give a reason.']),
    ],
    ...(input.reason ? { quote: { label: 'Their reason', text: input.reason } } : {}),
    details: [
      { label: 'Document', value: input.title },
      { label: 'Declined by', value: `${input.declinedBy} (${role})` },
    ],
    button: { label: 'Open the envelope', href: input.url },
    notes: [
      'You can revise it and send it again from the envelope page. Everyone signs the new version.',
    ],
    footer: {
      reason: 'You got this email because you sent this document from Codevibe Sign.',
      lines: input.org ? [input.org] : [],
      links: standardLinks(input.appUrl),
    },
  });
  return { subject: `Declined: ${input.title}`.replace(/[\r\n]+/g, ' '), ...body };
}

/** The one-time code a recipient asked for, in the workspace's brand. */
export function codeMail(
  input: { recipientName: string; code: string },
  brand: MailBrand,
): RenderedMail {
  const body = renderEmail({
    appUrl: brand.appUrl,
    preheader: `Your one-time code is ${input.code}. It expires in 10 minutes.`,
    header: brand.logoUrl
      ? { kind: 'logo', src: brand.logoUrl, alt: brand.company }
      : brand.showBadge
        ? { kind: 'codevibe' }
        : { kind: 'name', name: brand.company },
    heading: 'Your signing code',
    paragraphs: [
      `Hello ${input.recipientName},`,
      `Enter this code to confirm it is you and open the document from ${brand.company}.`,
    ],
    code: input.code,
    notes: [
      'It expires in 10 minutes. If you did not ask for it, you can ignore this email. Never share this code with anyone.',
    ],
    color: brand.brandColor,
    footer: {
      reason: `You got this email because you asked for a code to open a document from ${brand.company}.`,
      lines: brand.showBadge
        ? [
            'Sent with Codevibe Sign · Signing certificate provided by Codevibe Sign',
            ...(brand.org ? [brand.org] : []),
          ]
        : [],
      links: brand.showBadge ? standardLinks(brand.appUrl) : [],
    },
  });
  return { subject: `Your signing code is ${input.code}`, ...body };
}
