const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** GST allows at most 16 characters in an invoice number. */
export const INVOICE_NUMBER_MAX = 16;
export const INVOICE_SEQUENCE_DIGITS = 4;
export const DEFAULT_INVOICE_SERIES = 'CV-{FY}';
/** Reserved for credit notes and proforma invoices, so their numbers never collide with invoices. */
export const DEFAULT_CREDIT_NOTE_SERIES = 'CVCN-{FY}';
export const DEFAULT_PROFORMA_SERIES = 'CVPI-{FY}';

const SERIES_PATTERN = /^(?:[A-Za-z0-9/-]|\{FY\}|\{FYS\})*$/;

/** The calendar date in India at `at`. */
export function istDate(at: Date): { year: number; month: number; day: number } {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The year the Indian financial year (1 April to 31 March) of `at` started in, by IST. */
export function financialYearStart(at: Date): number {
  const { year, month } = istDate(at);
  return month >= 4 ? year : year - 1;
}

/** The financial year as six digits: 2026-27 is `202627`. */
export function financialYearCode(at: Date): string {
  const start = financialYearStart(at);
  return `${start}${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * `CV-{FY}` on 23 Nov 2026 is `CV-202627`, so the first invoice is `CV-2026270001`. `{FYS}` is
 * the year the financial year started in, `2026`.
 */
export const seriesPrefix = (series: string, at: Date) =>
  series
    .replaceAll('{FYS}', String(financialYearStart(at)))
    .replaceAll('{FY}', financialYearCode(at));

export const invoiceNumber = (prefix: string, sequence: number) =>
  `${prefix}${String(sequence).padStart(INVOICE_SEQUENCE_DIGITS, '0')}`;

/** Why a series cannot be used, or null. Letters, digits, `-`, `/`, `{FY}` and `{FYS}` only. */
export function seriesProblem(series: string): string | null {
  if (!SERIES_PATTERN.test(series)) {
    return 'may hold letters, digits, "-", "/", {FY} and {FYS} only';
  }
  const longest = seriesPrefix(series, new Date(0)).length + INVOICE_SEQUENCE_DIGITS;
  if (longest > INVOICE_NUMBER_MAX) {
    return `makes invoice numbers longer than ${INVOICE_NUMBER_MAX} characters`;
  }
  return null;
}

/** `23 Nov 2026`, the date in India. */
export function formatIstDate(at: Date): string {
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/** `23-11-2026`, the date in India. */
export function formatIstDashed(at: Date): string {
  const { year, month, day } = istDate(at);
  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
}
