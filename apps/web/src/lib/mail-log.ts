export const MAIL_LOG_RETENTION_DAYS = 90;
/** Rows shown on the Email log page. */
export const MAIL_LOG_LIMIT = 200;

export type MailLogStatus = 'sent' | 'failed';

const KIND_LABELS: Record<string, string> = {
  invite: 'Signing request',
  reminder: 'Reminder',
  completed_copy: 'Completed copy',
  cancelled: 'Cancelled',
  otp: 'Signing code',
  sign_in: 'Sign-in link',
  team_invite: 'Team invitation',
  password_reset: 'Password reset',
  password_changed: 'Password changed',
  decline_notice: 'Declined notice',
};

export const mailKindLabel = (kind: string) => KIND_LABELS[kind] ?? 'Other';

/** `1.2 MB`, `340 KB`, or an empty string for nothing attached. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `14:42 GMT+5:30` for today, `3 Nov, 14:42 GMT+5:30` otherwise, in `timeZone` or the local
 * zone, with the zone named.
 */
export function mailTime(iso: string, now: Date = new Date(), timeZone?: string): string {
  const at = new Date(iso);
  const zone = timeZone ? { timeZone } : {};
  const dayOf = (date: Date) => date.toLocaleDateString('en-CA', zone);
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
    ...zone,
  });
  if (dayOf(at) === dayOf(now)) return time;
  const year = (date: Date) => date.toLocaleDateString('en-GB', { year: 'numeric', ...zone });
  const day = at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year(at) !== year(now) ? { year: 'numeric' } : {}),
    ...zone,
  });
  return `${day}, ${time}`;
}

/** What the envelope page shows about the completed-copy email to one recipient. */
export interface CopyMailStatus {
  status: MailLogStatus;
  at: string;
  error: string | null;
}

export function copyMailLine(mail: CopyMailStatus, now: Date = new Date()): string {
  return mail.status === 'sent'
    ? `Copy emailed ${mailTime(mail.at, now)}`
    : `Email failed: ${mail.error ?? 'unknown error'}`;
}
