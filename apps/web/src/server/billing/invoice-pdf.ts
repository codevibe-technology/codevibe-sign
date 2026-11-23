import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BillingDetails } from '@/lib/billing/details';
import { stateByCode, type TaxBreakdown } from '@/lib/billing/gst';
import { formatIstDate } from '@/lib/billing/invoice-series';
import { amountInWords, formatInrFixed, type Paise } from '@/lib/billing/money';
import type { SellerConfig } from './config';

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPaise: Paise;
  amountPaise: Paise;
}

export interface InvoiceDocument {
  number: string;
  issuedAt: Date;
  seller: SellerConfig;
  buyer: BillingDetails;
  lines: InvoiceLine[];
  sac: string;
  tax: TaxBreakdown;
  /** The payment the invoice was raised for. */
  paymentRef: string | null;
  /** A payment made with test keys: the page says it is not a tax document. */
  test: boolean;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const RIGHT = A4.width - MARGIN;
const INK = rgb(0.09, 0.11, 0.16);
const MUTED = rgb(0.38, 0.42, 0.5);
const RULE = rgb(0.84, 0.86, 0.9);

const state = (code: string) => `${stateByCode(code)?.name ?? 'State'} (${code})`;
const percent = (value: number) => `${Number(value.toFixed(2))}%`;

/**
 * The standard fonts draw Latin text only. The rupee sign becomes "Rs." and any other character
 * they cannot draw becomes "?", so a name in another script never stops an invoice.
 */
function drawable(font: PDFFont, value: string): string {
  const text = value.replaceAll('₹', 'Rs. ').replace(/\s+/g, ' ').trim();
  const fits = (part: string) => {
    try {
      font.encodeText(part);
      return true;
    } catch {
      return false;
    }
  };
  return fits(text)
    ? text
    : Array.from(text)
        .map((character) => (fits(character) ? character : '?'))
        .join('');
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** A GST tax invoice on one A4 page. */
export async function renderInvoicePdf(invoice: InvoiceDocument): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.number}`);
  doc.setAuthor(invoice.seller.name);
  doc.setCreationDate(invoice.issuedAt);
  doc.setModificationDate(invoice.issuedAt);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = doc.addPage([A4.width, A4.height]);

  const text = (
    value: string,
    x: number,
    y: number,
    options: { font?: PDFFont; size?: number; muted?: boolean; right?: boolean } = {},
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? 9.5;
    const safe = drawable(font, value);
    page.drawText(safe, {
      x: options.right ? x - font.widthOfTextAtSize(safe, size) : x,
      y,
      size,
      font,
      color: options.muted ? MUTED : INK,
    });
  };
  const rule = (y: number) =>
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.7, color: RULE });
  /** Wrapped lines from `y` down; returns the y under the last one. */
  const block = (lines: string[], x: number, y: number, width: number, font = regular) => {
    let cursor = y;
    for (const line of lines) {
      for (const part of wrap(font, drawable(font, line), 9.5, width)) {
        text(part, x, cursor, { font });
        cursor -= 13;
      }
    }
    return cursor;
  };

  let y = A4.height - MARGIN - 8;
  text(invoice.test ? 'Test Invoice' : 'Tax Invoice', MARGIN, y, { font: bold, size: 20 });
  text(invoice.number, RIGHT, y + 4, { font: bold, size: 12, right: true });
  text(`Date: ${formatIstDate(invoice.issuedAt)}`, RIGHT, y - 12, { muted: true, right: true });
  y -= 18;
  if (invoice.test) {
    text('Made with test payment keys. Not a tax document; no money was paid.', MARGIN, y, {
      muted: true,
    });
  }
  y -= 16;
  rule(y);
  y -= 20;

  const column = (RIGHT - MARGIN - 24) / 2;
  const buyerX = MARGIN + column + 24;
  text('FROM', MARGIN, y, { size: 8, muted: true });
  text('BILLED TO', buyerX, y, { size: 8, muted: true });
  y -= 15;
  text(invoice.seller.name, MARGIN, y, { font: bold, size: 10.5 });
  text(invoice.buyer.legalName, buyerX, y, { font: bold, size: 10.5 });
  y -= 15;
  const sellerEnd = block(
    [
      invoice.seller.address,
      `GSTIN: ${invoice.seller.gstin}`,
      ...(invoice.seller.cin ? [`CIN: ${invoice.seller.cin}`] : []),
    ],
    MARGIN,
    y,
    column,
  );
  const { buyer } = invoice;
  const buyerEnd = block(
    [
      [buyer.addressLine1, buyer.addressLine2].filter(Boolean).join(', '),
      `${buyer.city}, ${stateByCode(buyer.stateCode)?.name ?? ''} ${buyer.pin}`,
      `GSTIN: ${buyer.gstin ?? 'Unregistered'}`,
      buyer.email,
    ],
    buyerX,
    y,
    column,
  );
  y = Math.min(sellerEnd, buyerEnd) - 6;
  text(`Place of supply: ${state(buyer.stateCode)}`, MARGIN, y);
  y -= 16;
  rule(y);
  y -= 16;

  const columns = { sac: 290, quantity: 345, rate: 435, amount: RIGHT };
  text('DESCRIPTION', MARGIN, y, { size: 8, muted: true });
  text('SAC', columns.sac, y, { size: 8, muted: true, right: true });
  text('QTY', columns.quantity, y, { size: 8, muted: true, right: true });
  text('RATE (INR)', columns.rate, y, { size: 8, muted: true, right: true });
  text('TAXABLE VALUE (INR)', columns.amount, y, { size: 8, muted: true, right: true });
  y -= 8;
  rule(y);
  y -= 16;
  for (const line of invoice.lines) {
    const parts = wrap(
      regular,
      drawable(regular, line.description),
      9.5,
      columns.sac - MARGIN - 50,
    );
    text(invoice.sac, columns.sac, y, { right: true });
    text(String(line.quantity), columns.quantity, y, { right: true });
    text(formatInrFixed(line.unitPaise), columns.rate, y, { right: true });
    text(formatInrFixed(line.amountPaise), columns.amount, y, { right: true });
    for (const part of parts) {
      text(part, MARGIN, y);
      y -= 13;
    }
    y -= 5;
  }
  rule(y);
  y -= 18;

  const { tax } = invoice;
  const totals: [string, Paise][] = [
    ['Taxable value', tax.taxablePaise],
    ...(tax.kind === 'intra'
      ? ([
          [`CGST @ ${percent(tax.cgstPercent)}`, tax.cgstPaise],
          [`SGST @ ${percent(tax.sgstPercent)}`, tax.sgstPaise],
        ] as [string, Paise][])
      : ([[`IGST @ ${percent(tax.igstPercent)}`, tax.igstPaise]] as [string, Paise][])),
  ];
  for (const [label, value] of totals) {
    text(label, columns.rate, y, { right: true, muted: true });
    text(formatInrFixed(value), columns.amount, y, { right: true });
    y -= 15;
  }
  y -= 3;
  text('Total (INR)', columns.rate, y, { font: bold, size: 11, right: true });
  text(formatInrFixed(tax.totalPaise), columns.amount, y, { font: bold, size: 11, right: true });
  y -= 24;
  y = block([`Amount in words: ${amountInWords(tax.totalPaise)}`], MARGIN, y, RIGHT - MARGIN);
  if (invoice.paymentRef) {
    text(`Paid online. Payment reference: ${invoice.paymentRef}`, MARGIN, y - 2);
  }

  rule(MARGIN + 26);
  text('This is a computer generated invoice and needs no signature.', MARGIN, MARGIN + 10, {
    size: 8.5,
    muted: true,
  });
  return doc.save();
}
