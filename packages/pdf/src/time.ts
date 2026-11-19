import { SignError } from '@codevibe/sign-core';

function parts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    result[part.type] = part.value;
  }
  return result;
}

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    throw new SignError(
      'VALIDATION',
      `Unknown time zone "${timeZone}". Use an IANA name such as Asia/Kolkata.`,
      {
        field: 'timeZone',
      },
    );
  }
}

export function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-11-19 10:15:03 UTC" */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** "2026-11-19 15:45:03 GMT+5:30 (Asia/Kolkata)" */
export function formatInZone(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName} (${timeZone})`;
}

/** UTC time, followed by the local time when a zone is given. */
export function formatMoment(value: string, timeZone?: string): string {
  const date = parseDate(value);
  if (!date) {
    return value;
  }
  const utc = formatUtc(date);
  return timeZone && timeZone !== 'UTC' ? `${utc} / ${formatInZone(date, timeZone)}` : utc;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a signing date as "19 Nov 2026". A plain ISO date is shown as is; a full
 * timestamp is converted to the time zone first (UTC when none is given).
 */
export function formatSigningDate(value: string, timeZone?: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) {
    const [, year, month, day] = plain;
    return `${day} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
  }
  const date = parseDate(value);
  if (!date) {
    return value;
  }
  const p = parts(date, timeZone ?? 'UTC');
  return `${p.day} ${MONTHS[Number(p.month) - 1] ?? p.month} ${p.year}`;
}
