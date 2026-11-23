export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  parts.find((p) => p.type === type)?.value ?? '';

/**
 * A moment as email text, with its zone named: `30 Nov 2026, 23:59 GMT+5:30`, or
 * `30 Nov 2026, 18:29 UTC` when no zone is given.
 */
export function formatMailDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone ?? 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(date);
  const day = `${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
  return `${day}, ${part(parts, 'hour')}:${part(parts, 'minute')} ${part(parts, 'timeZoneName')}`;
}
