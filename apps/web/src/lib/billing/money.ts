/** Amounts are whole paise everywhere; rupees appear only in configuration and on screen. */
export type Paise = number;

const INR_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/** `"24.99"` to 2499. Null for anything that is not a plain amount with at most two decimals. */
export function parseInr(value: string): Paise | null {
  const text = value.trim();
  if (!INR_PATTERN.test(text)) return null;
  const [rupees = '0', fraction = ''] = text.split('.');
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
}

/** `₹35`, `₹35.50`, `₹1,18,000`: Indian digit grouping, paise only when there are any. */
export function formatInr(paise: Paise, symbol = '₹'): string {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100).toLocaleString('en-IN');
  const rest = absolute % 100;
  return `${sign}${symbol}${rupees}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`;
}

/** `1,180.00`: always two decimals, for invoice columns. */
export function formatInrFixed(paise: Paise): string {
  const rupees = Math.floor(Math.abs(paise) / 100).toLocaleString('en-IN');
  return `${paise < 0 ? '-' : ''}${rupees}.${String(Math.abs(paise) % 100).padStart(2, '0')}`;
}

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const ones = n % 10;
  return `${TENS[Math.floor(n / 10)]}${ones ? ` ${ONES[ones]}` : ''}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return belowHundred(rest);
  return `${ONES[hundreds]} Hundred${rest ? ` ${belowHundred(rest)}` : ''}`;
}

/** A whole number in words with Indian grouping: thousand, lakh, crore. */
export function numberInWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('numberInWords needs a whole number');
  if (value === 0) return ONES[0]!;
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** `Rupees One Thousand One Hundred Eighty and Fifty Paise Only`. */
export function amountInWords(paise: Paise): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${numberInWords(rupees)}${rest ? ` and ${belowHundred(rest)} Paise` : ''} Only`;
}
