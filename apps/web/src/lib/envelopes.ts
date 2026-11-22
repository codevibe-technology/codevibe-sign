import type {
  AuditAction,
  AuditEvent,
  AuthMethod,
  EnvelopeStatus,
  RecipientRole,
  RecipientStatus,
} from '@codevibe_technology/sign-core';

/** One row of `GET /v1/envelopes`. */
export interface EnvelopeSummary {
  id: string;
  title: string;
  status: EnvelopeStatus;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  documents: { id: string; name: string; pageCount: number }[];
  recipients: {
    id: string;
    name: string;
    email: string | null;
    role: RecipientRole;
    status: RecipientStatus;
    actedAt: string | null;
    declineReason?: string | null;
  }[];
}

/** "Declined by Ravi: wrong salary" for a declined envelope's list row, or null. */
export function declineLine(envelope: Pick<EnvelopeSummary, 'status' | 'recipients'>) {
  if (envelope.status !== 'declined') return null;
  const r = envelope.recipients.find((x) => x.status === 'declined');
  if (!r) return null;
  return r.declineReason ? `Declined by ${r.name}: ${r.declineReason}` : `Declined by ${r.name}`;
}

export interface EnvelopePage {
  envelopes: EnvelopeSummary[];
  nextCursor: string | null;
}

export type Tone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';

export const STATUS_LABELS: Record<EnvelopeStatus, string> = {
  draft: 'Draft',
  sent: 'Waiting for others',
  in_progress: 'Waiting for others',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  voided: 'Voided',
};

export const STATUS_TONES: Record<EnvelopeStatus, Tone> = {
  draft: 'neutral',
  sent: 'warning',
  in_progress: 'warning',
  completed: 'success',
  declined: 'danger',
  expired: 'neutral',
  voided: 'neutral',
};

/** The status filters people think in; "waiting" covers sent and in progress. */
export const STATUS_FILTERS = [
  { key: 'draft', label: 'Drafts', statuses: ['draft'] },
  { key: 'waiting', label: 'Waiting for others', statuses: ['sent', 'in_progress'] },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'declined', label: 'Declined', statuses: ['declined'] },
  { key: 'expired', label: 'Expired', statuses: ['expired'] },
  { key: 'voided', label: 'Voided', statuses: ['voided'] },
] as const satisfies readonly { key: string; label: string; statuses: EnvelopeStatus[] }[];

export type StatusFilterKey = (typeof STATUS_FILTERS)[number]['key'];

export const isStatusFilter = (value: unknown): value is StatusFilterKey =>
  STATUS_FILTERS.some((f) => f.key === value);

export const statusesFor = (key: StatusFilterKey): readonly EnvelopeStatus[] =>
  STATUS_FILTERS.find((f) => f.key === key)!.statuses;

export const isOpen = (status: EnvelopeStatus) => status === 'sent' || status === 'in_progress';

export const isFinalStatus = (status: EnvelopeStatus) =>
  status === 'completed' || status === 'declined' || status === 'expired' || status === 'voided';

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: 'Not yet invited',
  notified: 'Invited',
  viewed: 'Opened',
  signed: 'Signed',
  approved: 'Approved',
  declined: 'Declined',
};

export const RECIPIENT_STATUS_TONES: Record<RecipientStatus, Tone> = {
  pending: 'neutral',
  notified: 'primary',
  viewed: 'warning',
  signed: 'success',
  approved: 'success',
  declined: 'danger',
};

export const ROLE_OPTIONS: { value: RecipientRole; label: string; hint: string }[] = [
  { value: 'signer', label: 'Signer', hint: 'Fills in fields and signs.' },
  { value: 'approver', label: 'Approver', hint: 'Reviews and approves, no fields.' },
  { value: 'viewer', label: 'Gets a copy', hint: 'Receives the signed copy only.' },
];

/**
 * Identity checks a sender can pick, the default first. A one-time code is the default
 * because a link alone proves only access to the inbox, which is weaker evidence.
 */
export const AUTH_OPTIONS: { value: Exclude<AuthMethod, 'aadhaar'>; label: string }[] = [
  { value: 'email_otp', label: 'Email link + code (recommended)' },
  { value: 'sms_otp', label: 'Email link + SMS code' },
  { value: 'email_link', label: 'Email link only' },
];

export const AUTH_LABELS: Record<AuthMethod, string> = {
  email_link: 'Email link',
  email_otp: 'Email code',
  sms_otp: 'SMS code',
  aadhaar: 'Aadhaar',
};

const ACTION_LABELS: Record<AuditAction, string> = {
  'envelope.created': 'Draft created',
  'envelope.updated': 'Draft edited',
  'envelope.sent': 'Sent for signature',
  'envelope.completed': 'Completed by everyone',
  'envelope.declined': 'Declined',
  'envelope.expired': 'Expired',
  'envelope.voided': 'Voided',
  'envelope.recalled': 'Recalled to correct',
  'envelope.revised': 'Revised after the decline',
  'recipient.notified': 'Invited',
  'recipient.reminded': 'Reminded',
  'recipient.viewed': 'Opened the document',
  'recipient.authenticated': 'Verified their identity',
  'recipient.signed': 'Signed',
  'recipient.approved': 'Approved',
  'recipient.declined': 'Declined',
  'recipient.link_shared': 'Link shared manually',
  'recipient.corrected': 'Details corrected',
  'document.sealed': 'Document sealed',
};

/** `a***@example.com`: enough to recognise an address without showing all of it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export interface EventDetail {
  /** The timeline line, for example "Link shared manually by Meera". */
  label: string;
  /** A second line with what changed, if any. */
  note?: string;
  /** The other envelope of a recall or revision. */
  link?: { envelopeId: string; title: string; prefix: string };
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** How the timeline shows one event, with who did it and the envelope it links to. */
export function eventDetail(event: Pick<AuditEvent, 'action' | 'data'>): EventDetail {
  const by = text(event.data?.by);
  const byLine = by ? ` by ${by}` : '';
  const base = actionLabel(event.action);
  switch (event.action) {
    case 'recipient.link_shared':
      return { label: `${base}${byLine}` };
    case 'recipient.corrected': {
      const changes: string[] = [];
      const oldName = text(event.data?.oldName);
      const newName = text(event.data?.newName);
      if (oldName && newName) changes.push(`name ${oldName} → ${newName}`);
      const oldEmail = text(event.data?.oldEmail);
      const newEmail = text(event.data?.newEmail);
      if (oldEmail || newEmail) {
        changes.push(
          `email ${oldEmail ? maskEmail(oldEmail) : 'none'} → ${newEmail ? maskEmail(newEmail) : 'none'}`,
        );
      }
      if (event.data?.oldPhone !== undefined || event.data?.newPhone !== undefined) {
        changes.push('phone changed');
      }
      if (event.data?.invited === true) changes.push('new invitation sent');
      return { label: `${base}${byLine}`, ...(changes.length ? { note: changes.join('; ') } : {}) };
    }
    case 'envelope.recalled':
    case 'envelope.revised': {
      const id = text(event.data?.replacementId);
      return {
        label: `${base}${byLine}`,
        ...(id
          ? {
              link: {
                envelopeId: id,
                title: text(event.data?.replacementTitle) ?? 'the new draft',
                prefix: 'Replaced by',
              },
            }
          : {}),
      };
    }
    case 'envelope.created': {
      const recalled = text(event.data?.recalledFrom);
      const revised = text(event.data?.revisedFrom);
      const from = recalled ?? revised;
      if (!from) return { label: base };
      const title =
        text(recalled ? event.data?.recalledFromTitle : event.data?.revisedFromTitle) ??
        'the earlier envelope';
      return {
        label: recalled ? `Corrected copy made${byLine}` : `Revision made${byLine}`,
        link: {
          envelopeId: from,
          title,
          prefix: recalled ? 'Copy of the recalled' : 'Revision of the declined',
        },
      };
    }
    default:
      return { label: base };
  }
}

export const actionLabel = (action: string) =>
  (ACTION_LABELS as Record<string, string>)[action] ?? action;

export const actionTone = (action: string): Tone => {
  if (/signed|approved|completed|sealed/.test(action)) return 'success';
  if (/declined|voided|expired/.test(action)) return 'danger';
  if (/sent|notified|reminded/.test(action)) return 'primary';
  return 'neutral';
};

/** "Asha, Ravi and 2 more" */
export function peopleLine(names: string[], max = 2): string {
  if (names.length === 0) return 'No recipients';
  if (names.length <= max) return names.join(' and ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/** Signers and approvers who have acted, out of all of them. */
export function progressOf(recipients: EnvelopeSummary['recipients']) {
  const actors = recipients.filter((r) => r.role !== 'viewer');
  const done = actors.filter((r) => r.status === 'signed' || r.status === 'approved').length;
  return { done, total: actors.length };
}

const DAY = 86_400_000;

/** Short, human relative time: "just now", "5 min ago", "yesterday", "12 Mar". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const diff = now.getTime() - at.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  if (abs < 60_000) return future ? 'in a moment' : 'just now';
  if (abs < 3_600_000) {
    const m = Math.round(abs / 60_000);
    return future ? `in ${m} min` : `${m} min ago`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / 3_600_000);
    return future ? `in ${h} h` : `${h} h ago`;
  }
  if (abs < 2 * DAY) return future ? 'tomorrow' : 'yesterday';
  if (abs < 7 * DAY) {
    const d = Math.round(abs / DAY);
    return future ? `in ${d} days` : `${d} days ago`;
  }
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * `23 Nov 2026, 00:23` in `timeZone`, or in the zone of whatever runs this when none is given.
 * A server-rendered page does not know the reader's zone: show times with `LocalTime` there.
 */
export const formatDateTime = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });

export const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'title', label: 'Title A–Z' },
  { key: 'status', label: 'Status' },
] as const;
export type SortKey = (typeof SORTS)[number]['key'];

const STATUS_ORDER = ['draft', 'sent', 'in_progress', 'completed', 'declined', 'expired', 'voided'];

/** Sorts the rows already loaded; the API pages newest first. */
export function sortEnvelopes(rows: EnvelopeSummary[], sort: SortKey): EnvelopeSummary[] {
  const copy = rows.slice();
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'oldest':
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
    case 'status':
      return copy.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  }
}
