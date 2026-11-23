import 'server-only';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type RGB } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import type { BillingDetails } from '@/lib/billing/details';
import { stateByCode, type TaxBreakdown } from '@/lib/billing/gst';
import { formatIstDashed, formatIstDate } from '@/lib/billing/invoice-series';
import { formatInrFixed, numberInWords, type Paise } from '@/lib/billing/money';
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
  /** How it was paid, as the payment service names it: `upi`, `card`, `netbanking`. */
  paymentMethod?: string | null;
  /** A payment made with test keys: the page says it is not a tax document. */
  test: boolean;
}

/** What the page is drawn with besides the invoice's own figures. All of it is optional. */
export interface InvoiceAssets {
  /** TrueType fonts that have the rupee sign. Without them the page uses Helvetica and "Rs.". */
  fonts?: { regular: Uint8Array; bold: Uint8Array } | undefined;
  /** PNG or JPEG, drawn top right. */
  logo?: Uint8Array | undefined;
  /** PNG or JPEG, drawn above "Authorized Signatory". */
  signature?: Uint8Array | undefined;
  /** The file gets a digital signature after rendering, so the footer may say so. */
  digitallySigned?: boolean | undefined;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const LEFT = MARGIN;
const RIGHT = A4.width - MARGIN;
const WIDTH = RIGHT - LEFT;
const INK = rgb(0.09, 0.11, 0.16);
const MUTED = rgb(0.4, 0.44, 0.52);
const RULE = rgb(0.84, 0.86, 0.9);
const SHADE = rgb(0.955, 0.965, 0.98);
const BLUE = rgb(0.09, 0.38, 0.82);
const GREEN = rgb(0.05, 0.56, 0.33);
const WHITE = rgb(1, 1, 1);

const METHODS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net Banking',
  wallet: 'Wallet',
  emi: 'EMI',
  bank_transfer: 'Bank Transfer',
};

const percent = (value: number) => `${value.toFixed(1)}%`;

/** `06-HARYANA`, the way a place of supply is written. */
const placeOfSupply = (code: string) =>
  `${code}-${(stateByCode(code)?.name ?? 'State').toUpperCase()}`;

/** `INR One Thousand One Hundred Eighty Rupees and Fifty Paise Only.` */
export function invoiceAmountInWords(paise: Paise): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `INR ${numberInWords(rupees)} Rupees${rest ? ` and ${numberInWords(rest)} Paise` : ''} Only.`;
}

/**
 * Splits the invoice's tax over its lines in proportion to their value, to the paisa, so the
 * line figures always add up to the totals the order was charged with.
 */
export function lineTaxes(lines: InvoiceLine[], tax: TaxBreakdown): Paise[] {
  let left = tax.taxPaise;
  let valueLeft = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  return lines.map((line) => {
    const share = valueLeft > 0 ? Math.round((left * line.amountPaise) / valueLeft) : 0;
    left -= share;
    valueLeft -= line.amountPaise;
    return share;
  });
}

function upiLink(seller: SellerConfig, number: string): string | null {
  if (!seller.upiId) return null;
  const query = new URLSearchParams({ pa: seller.upiId, pn: seller.name, cu: 'INR', tn: number });
  return `upi://pay?${query.toString()}`;
}

function qrMatrix(value: string): boolean[][] {
  const code = qrcode(0, 'M');
  code.addData(value);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => code.isDark(row, column)),
  );
}

interface TextOptions {
  font?: PDFFont;
  size?: number;
  color?: RGB;
  right?: boolean;
  /** Extra space between letters, for spaced capitals. */
  spacing?: number;
}

/** A GST tax invoice on one A4 page. */
export async function renderInvoicePdf(
  invoice: InvoiceDocument,
  assets: InvoiceAssets = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.number}`);
  doc.setAuthor(invoice.seller.name);
  doc.setCreationDate(invoice.issuedAt);
  doc.setModificationDate(invoice.issuedAt);

  let regular: PDFFont;
  let bold: PDFFont;
  let rupee = '₹';
  if (assets.fonts) {
    doc.registerFontkit(fontkit);
    regular = await doc.embedFont(assets.fonts.regular, { subset: true });
    bold = await doc.embedFont(assets.fonts.bold, { subset: true });
  } else {
    regular = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
    rupee = 'Rs. ';
  }
  const embedImage = async (bytes: Uint8Array | undefined): Promise<PDFImage | null> => {
    if (!bytes) return null;
    try {
      return bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      return null;
    }
  };
  const logo = await embedImage(assets.logo);
  const signature = await embedImage(assets.signature);
  const page = doc.addPage([A4.width, A4.height]);

  const glyphs = new Map<PDFFont, Set<number>>();
  /** A character the font cannot draw becomes "?", so a name in another script never stops an invoice. */
  const drawable = (font: PDFFont, value: string): string => {
    let set = glyphs.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      glyphs.set(font, set);
    }
    const known = set;
    return Array.from(value.replaceAll('₹', rupee).replace(/\s+/g, ' ').trim())
      .map((character) => (known.has(character.codePointAt(0)!) ? character : '?'))
      .join('');
  };
  const money = (paise: Paise) => `${rupee}${formatInrFixed(paise)}`;
  const widthOf = (value: string, font: PDFFont, size: number) =>
    font.widthOfTextAtSize(drawable(font, value), size);

  const text = (value: string, x: number, y: number, options: TextOptions = {}) => {
    const font = options.font ?? regular;
    const size = options.size ?? 9;
    const color = options.color ?? INK;
    const safe = drawable(font, value);
    if (options.spacing) {
      let cursor = x;
      for (const character of safe) {
        page.drawText(character, { x: cursor, y, size, font, color });
        cursor += font.widthOfTextAtSize(character, size) + options.spacing;
      }
      return;
    }
    page.drawText(safe, {
      x: options.right ? x - font.widthOfTextAtSize(safe, size) : x,
      y,
      size,
      font,
      color,
    });
  };
  /** A label followed by its value in bold on the same line; returns the x after it. */
  const pair = (label: string, value: string, x: number, y: number, size = 9) => {
    text(label, x, y, { size, color: MUTED });
    const valueX = x + widthOf(label, regular, size) + 3;
    text(value, valueX, y, { size, font: bold });
    return valueX + widthOf(value, bold, size);
  };
  const wrap = (value: string, font: PDFFont, size: number, width: number): string[] => {
    const lines: string[] = [];
    let current = '';
    for (const word of drawable(font, value).split(' ')) {
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
  };
  /** Wrapped lines from `y` down; returns the y under the last one. */
  const block = (
    lines: string[],
    x: number,
    y: number,
    width: number,
    options: TextOptions & { leading?: number } = {},
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? 9;
    let cursor = y;
    for (const line of lines) {
      for (const part of wrap(line, font, size, width)) {
        text(part, x, cursor, options);
        cursor -= options.leading ?? size + 3.5;
      }
    }
    return cursor;
  };
  const rule = (y: number, from = LEFT, to = RIGHT) =>
    page.drawLine({ start: { x: from, y }, end: { x: to, y }, thickness: 0.7, color: RULE });
  const shade = (y: number, height: number) =>
    page.drawRectangle({ x: LEFT, y, width: WIDTH, height, color: SHADE });

  const { seller, buyer, tax } = invoice;
  const intra = tax.kind === 'intra';

  // Header: who issues the invoice on the left, the copy mark and the logo on the right.
  let y = A4.height - MARGIN - 6;
  text(invoice.test ? 'TEST INVOICE' : 'TAX INVOICE', LEFT, y, {
    font: bold,
    size: 9.5,
    color: BLUE,
    spacing: 1.6,
  });
  text('ORIGINAL FOR RECIPIENT', RIGHT, y, { size: 7, color: MUTED, right: true });
  if (logo) {
    const scale = Math.min(120 / logo.width, 46 / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    page.drawImage(logo, { x: RIGHT - width, y: y - 10 - height, width, height });
  }
  const headerWidth = WIDTH - 150;
  y -= 20;
  y = block([seller.name.toUpperCase()], LEFT, y, headerWidth, {
    font: bold,
    size: 14,
    leading: 17,
  });
  y += 2;
  let x = pair('GSTIN', seller.gstin, LEFT, y);
  if (seller.pan) x = pair('PAN', seller.pan, x + 12, y);
  if (seller.cin) pair('CIN', seller.cin, x + 12, y);
  y -= 13;
  y = block([seller.address], LEFT, y, headerWidth, { color: MUTED });
  if (seller.phone || seller.email) {
    x = LEFT;
    if (seller.phone) x = pair('Mobile', seller.phone, x, y) + 12;
    if (seller.email) pair('Email', seller.email, x, y);
    y -= 12.5;
  }
  if (seller.website) {
    pair('Website', seller.website, LEFT, y);
    y -= 12.5;
  }
  if (invoice.test) {
    text('Made with test payment keys. Not a tax document; no money was paid.', LEFT, y, {
      color: MUTED,
    });
    y -= 12.5;
  }

  // Number and dates.
  y -= 2;
  rule(y);
  y -= 15;
  const issued = formatIstDate(invoice.issuedAt);
  pair('Invoice #:', invoice.number, LEFT, y, 9.5);
  pair('Invoice Date:', issued, LEFT + WIDTH * 0.4, y, 9.5);
  pair('Due Date:', issued, LEFT + WIDTH * 0.72, y, 9.5);
  y -= 9;
  rule(y);

  // Customer and billing address.
  y -= 15;
  const half = WIDTH / 2 - 10;
  const addressX = LEFT + WIDTH / 2 + 10;
  text('Customer Details:', LEFT, y, { size: 8.5, color: MUTED });
  text('Billing Address:', addressX, y, { size: 8.5, color: MUTED });
  y -= 13;
  let customerY = block([buyer.legalName], LEFT, y, half, { font: bold, size: 10, leading: 13 });
  pair('GSTIN:', buyer.gstin ?? 'Unregistered', LEFT, customerY);
  customerY -= 12.5;
  pair('Email:', buyer.email, LEFT, customerY);
  customerY -= 12.5;
  const addressY = block(
    [
      [buyer.addressLine1, buyer.addressLine2].filter(Boolean).join(', '),
      `${buyer.city}, ${(stateByCode(buyer.stateCode)?.name ?? '').toUpperCase()}, ${buyer.pin}`,
    ],
    addressX,
    y,
    half,
  );
  y = Math.min(customerY, addressY) - 2;
  pair('Place of Supply:', placeOfSupply(buyer.stateCode), LEFT, y);
  y -= 12;

  // Items.
  const rate = Number((intra ? tax.cgstPercent + tax.sgstPercent : tax.igstPercent).toFixed(2));
  const column = {
    index: LEFT + 6,
    item: LEFT + 24,
    rate: RIGHT - 258,
    quantity: RIGHT - 222,
    taxable: RIGHT - 148,
    tax: RIGHT - 70,
    amount: RIGHT - 6,
  };
  const itemWidth = column.rate - 62 - column.item;
  shade(y - 20, 20);
  rule(y);
  rule(y - 20);
  const head = { font: bold, size: 8 };
  text('#', column.index, y - 13, head);
  text('Item', column.item, y - 13, head);
  text('Rate / Item', column.rate, y - 13, { ...head, right: true });
  text('Qty', column.quantity, y - 13, { ...head, right: true });
  text('Taxable Value', column.taxable, y - 13, { ...head, right: true });
  text('Tax Amount', column.tax, y - 13, { ...head, right: true });
  text('Amount', column.amount, y - 13, { ...head, right: true });
  y -= 34;
  const taxes = lineTaxes(invoice.lines, tax);
  let quantity = 0;
  invoice.lines.forEach((line, index) => {
    quantity += line.quantity;
    text(String(index + 1), column.index, y);
    text(money(line.unitPaise), column.rate, y, { right: true });
    text(String(line.quantity), column.quantity, y, { right: true });
    text(money(line.amountPaise), column.taxable, y, { right: true });
    text(`${money(taxes[index]!)} (${rate}%)`, column.tax, y, { right: true });
    text(money(line.amountPaise + taxes[index]!), column.amount, y, { right: true, font: bold });
    const end = block([line.description], column.item, y, itemWidth, { font: bold });
    text(`SAC: ${invoice.sac}`, column.item, end, { size: 8, color: MUTED });
    y = end - 15;
  });
  rule(y + 6);

  // Totals on the right, the item count on the left.
  y -= 8;
  text(`Total Items / Qty : ${invoice.lines.length} / ${quantity}`, LEFT, y, { color: MUTED });
  const totals: [string, Paise][] = [
    ['Taxable Amount', tax.taxablePaise],
    ...(intra
      ? ([
          [`CGST ${percent(tax.cgstPercent)}`, tax.cgstPaise],
          [`SGST ${percent(tax.sgstPercent)}`, tax.sgstPaise],
        ] as [string, Paise][])
      : ([[`IGST ${percent(tax.igstPercent)}`, tax.igstPaise]] as [string, Paise][])),
  ];
  for (const [label, value] of totals) {
    text(label, column.taxable, y, { right: true, color: MUTED });
    text(money(value), column.amount, y, { right: true });
    y -= 14;
  }
  rule(y + 6, column.rate - 40);
  y -= 6;
  text('Total', column.taxable, y, { font: bold, size: 12, right: true });
  text(money(tax.totalPaise), column.amount, y, { font: bold, size: 12, right: true });
  y -= 18;
  y = block([`Total amount (in words): ${invoiceAmountInWords(tax.totalPaise)}`], LEFT, y, WIDTH, {
    color: MUTED,
  });

  // Payment.
  if (invoice.paymentRef) {
    y -= 4;
    const label = 'Amount Paid';
    const tickX = RIGHT - widthOf(label, bold, 9.5) - 12;
    page.drawCircle({ x: tickX, y: y + 3.2, size: 5.5, color: GREEN });
    page.drawLine({
      start: { x: tickX - 2.8, y: y + 3.2 },
      end: { x: tickX - 0.8, y: y + 1 },
      thickness: 1.1,
      color: WHITE,
    });
    page.drawLine({
      start: { x: tickX - 0.8, y: y + 1 },
      end: { x: tickX + 2.8, y: y + 5.6 },
      thickness: 1.1,
      color: WHITE,
    });
    text(label, RIGHT, y, { font: bold, size: 9.5, color: GREEN, right: true });
    y -= 13;
    const method = METHODS[invoice.paymentMethod ?? ''] ?? 'Razorpay';
    text(
      `${money(tax.totalPaise)} Paid via ${method} on ${formatIstDashed(invoice.issuedAt)} (${invoice.paymentRef})`,
      RIGHT,
      y,
      { size: 8.5, color: MUTED, right: true },
    );
    y -= 10;
  }

  // Tax summary by SAC.
  y -= 8;
  const summary = intra
    ? {
        sac: LEFT + 6,
        taxable: LEFT + 190,
        firstRate: LEFT + 240,
        first: LEFT + 310,
        secondRate: LEFT + 360,
        second: LEFT + 430,
        total: RIGHT - 6,
      }
    : {
        sac: LEFT + 6,
        taxable: LEFT + 220,
        firstRate: LEFT + 300,
        first: LEFT + 400,
        secondRate: 0,
        second: 0,
        total: RIGHT - 6,
      };
  const small = { size: 7.5, color: MUTED, right: true };
  shade(y - 30, 30);
  rule(y);
  rule(y - 30);
  text('HSN/SAC', summary.sac, y - 18, head);
  text('Taxable Value', summary.taxable, y - 18, { ...head, right: true });
  text(intra ? 'Central Tax' : 'Integrated Tax', summary.first, y - 12, { ...head, right: true });
  text('Rate', summary.firstRate, y - 24, small);
  text('Amount', summary.first, y - 24, small);
  if (intra) {
    text('State/UT Tax', summary.second, y - 12, { ...head, right: true });
    text('Rate', summary.secondRate, y - 24, small);
    text('Amount', summary.second, y - 24, small);
  }
  text('Total Tax', summary.total, y - 18, { ...head, right: true });
  y -= 43;
  const summaryRow = (label: string, strong: boolean) => {
    const font = strong ? bold : regular;
    text(label, summary.sac, y, { font });
    text(money(tax.taxablePaise), summary.taxable, y, { right: true, font });
    if (!strong) {
      text(percent(intra ? tax.cgstPercent : tax.igstPercent), summary.firstRate, y, {
        right: true,
      });
    }
    text(money(intra ? tax.cgstPaise : tax.igstPaise), summary.first, y, { right: true, font });
    if (intra) {
      if (!strong) text(percent(tax.sgstPercent), summary.secondRate, y, { right: true });
      text(money(tax.sgstPaise), summary.second, y, { right: true, font });
    }
    text(money(tax.taxPaise), summary.total, y, { right: true, font });
  };
  summaryRow(invoice.sac, false);
  y -= 7;
  rule(y);
  y -= 13;
  summaryRow('TOTAL', true);
  y -= 7;
  rule(y);

  // How to pay, and who signs.
  y -= 18;
  const bottom = y;
  let payX = LEFT;
  const link = upiLink(seller, invoice.number);
  if (link) {
    text('Pay using UPI:', LEFT, y, { size: 8.5, font: bold });
    const matrix = qrMatrix(link);
    const size = 74;
    const cell = size / matrix.length;
    const top = y - 8;
    matrix.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) {
          page.drawRectangle({
            x: LEFT + c * cell,
            y: top - (r + 1) * cell,
            width: cell + 0.05,
            height: cell + 0.05,
            color: INK,
          });
        }
      }),
    );
    text(seller.upiId!, LEFT, top - size - 10, { size: 7.5, color: MUTED });
    payX = LEFT + size + 28;
  }
  if (seller.bank) {
    text('Bank Details:', payX, y, { size: 8.5, font: bold });
    let bankY = y - 14;
    const rows: [string, string | undefined][] = [
      ['Bank:', seller.bank.name],
      ['Account Holder:', seller.bank.holder],
      ['Account #:', seller.bank.account],
      ['IFSC:', seller.bank.ifsc],
      ['Branch:', seller.bank.branch],
    ];
    for (const [label, value] of rows) {
      if (!value) continue;
      text(label, payX, bankY, { size: 8.5, color: MUTED });
      bankY = block([value], payX + 72, bankY, RIGHT - 150 - (payX + 72), {
        size: 8.5,
        font: bold,
        leading: 12,
      });
    }
  }
  text(`For ${seller.name.toUpperCase()}`, RIGHT, bottom, { size: 8.5, right: true });
  if (signature) {
    const scale = Math.min(120 / signature.width, 44 / signature.height);
    const width = signature.width * scale;
    const height = signature.height * scale;
    page.drawImage(signature, { x: RIGHT - width, y: bottom - 10 - height, width, height });
  }
  text('Authorized Signatory', RIGHT, bottom - 68, { size: 8.5, color: MUTED, right: true });

  rule(MARGIN + 16);
  const closing = assets.digitallySigned
    ? 'This is a digitally signed document.'
    : 'This is a computer generated document.';
  text(`Page 1 / 1 • ${closing}`, LEFT, MARGIN + 4, { size: 7.5, color: MUTED });
  return doc.save();
}
