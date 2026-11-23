import type { Paise } from './money';

export const TERMS = ['month', 'year'] as const;
export type Term = (typeof TERMS)[number];

export const isTerm = (value: unknown): value is Term =>
  typeof value === 'string' && (TERMS as readonly string[]).includes(value);

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/**
 * The same time of day `months` later on the India calendar. A day the later month does not
 * have becomes its last day: 31 January plus one month is 28 or 29 February.
 */
export function addMonths(from: Date, months: number): Date {
  const local = new Date(from.getTime() + IST_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const moved = Date.UTC(
    year,
    month,
    Math.min(local.getUTCDate(), lastDay),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(moved - IST_OFFSET_MS);
}

/** Calendar months a term runs for. */
export const termLength = (term: Term) => (term === 'year' ? 12 : 1);

/** When a term that starts at `start` ends. */
export const termEnd = (start: Date, term: Term) => addMonths(start, termLength(term));

/** Months a term is charged for: a year costs `annualMonths` of them. */
export const billedMonths = (term: Term, annualMonths: number) =>
  term === 'year' ? annualMonths : 1;

/** What one term of something priced by the month costs. */
export const termPrice = (monthlyPaise: Paise, term: Term, annualMonths: number): Paise =>
  monthlyPaise * billedMonths(term, annualMonths);

/** Days from `from` to `to`, any started day counting as one; never negative. */
export const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));

/**
 * The price of the rest of a term: the full price times the days left over the days in the
 * term, to the nearest paisa with halves rounded up. Never more than the full price.
 */
export function proratedPrice(
  fullPaise: Paise,
  period: { start: Date; end: Date },
  now: Date,
): Paise {
  const total = daysBetween(period.start, period.end);
  const left = Math.min(total, daysBetween(now, period.end));
  if (total === 0 || left === 0) return 0;
  return Math.floor((fullPaise * left * 2 + total) / (total * 2));
}

const day = (date: Date) =>
  date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

/** `23 Nov 2026`, the day in India. */
export const formatTermDay = day;

/** `23 Nov 2026 to 22 Dec 2026`: the first and the last day a term covers, in India. */
export const formatPeriod = (start: Date, end: Date) =>
  `${day(start)} to ${day(new Date(end.getTime() - DAY_MS))}`;

export const TERM_LABELS: Record<Term, string> = { month: '1 month', year: '1 year' };

/** Which reminder is due with this many days left, or null: 7, 3 and 1 days before the end. */
export function reminderStage(daysLeft: number): 7 | 3 | 1 | null {
  if (daysLeft <= 0) return null;
  if (daysLeft <= 1) return 1;
  if (daysLeft <= 3) return 3;
  if (daysLeft <= 7) return 7;
  return null;
}

/** A term can be paid for again this many days before it ends. */
export const RENEWAL_WINDOW_DAYS = 7;
