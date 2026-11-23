import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { createDevSeal, verifySeal } from '@codevibe_technology/sign-pdf';
import { describe, expect, it } from 'vitest';
import type { BillingDetails } from '@/lib/billing/details';
import { computeTax } from '@/lib/billing/gst';
import { billingConfig } from './config';
import { invoiceRendering } from './invoice-assets';
import {
  invoiceAmountInWords,
  lineTaxes,
  renderInvoicePdf,
  type InvoiceDocument,
} from './invoice-pdf';

const config = billingConfig({
  INVOICE_SELLER_NAME: 'Codevibe Technology',
  INVOICE_SELLER_GSTIN: '06AANCC6406C1ZX',
  INVOICE_SELLER_ADDRESS:
    'Tower A 309, 3rd floor, SAS Tower, medicity, Gurugram, Gurugram, HARYANA, 122001',
  INVOICE_SELLER_PHONE: '+91 7067709224, 7999582512',
  INVOICE_SELLER_EMAIL: 'hello@codevibe.in',
  INVOICE_SELLER_WEBSITE: 'www.codevibe.in',
  INVOICE_UPI_ID: 'codevibe@idfcbank',
  INVOICE_BANK_NAME: 'IDFC FIRST Bank',
  INVOICE_BANK_HOLDER: 'CODEVIBE TECHNOLOGY PRIVATE LIMITED',
  INVOICE_BANK_ACCOUNT: '60209181573',
  INVOICE_BANK_IFSC: 'IDFB0021003',
  INVOICE_BANK_BRANCH: 'GURGAON SECTOR FOURTEEN BRANCH',
});
const seller = config.seller!;

const buyerIn = (stateCode: string, city: string, gstin: string | null): BillingDetails => ({
  legalName: 'Acme Traders Private Limited',
  gstin,
  addressLine1: '14 Residency Road',
  addressLine2: 'Second Floor',
  city,
  pin: stateCode === '06' ? '122002' : '560025',
  stateCode,
  email: 'accounts@acme.example',
});

function invoice(buyer: BillingDetails, overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  const lines = [
    {
      description: 'Aadhaar eSign credits × 50 @ ₹35',
      quantity: 50,
      unitPaise: 3500,
      amountPaise: 175_000,
    },
  ];
  return {
    number: 'CV-2026270001',
    issuedAt: new Date('2026-11-23T10:00:00Z'),
    seller,
    buyer,
    lines,
    sac: '998319',
    tax: computeTax({
      taxablePaise: 175_000,
      gstPercent: 18,
      sellerStateCode: seller.stateCode,
      buyerStateCode: buyer.stateCode,
    }),
    paymentRef: 'pay_Qw12ErTy34UiOp',
    paymentMethod: 'upi',
    test: false,
    ...overrides,
  };
}

const karnataka = buyerIn('29', 'Bengaluru', null);
const haryana = buyerIn('06', 'Gurugram', '06AANCC6406C1ZX');

/** The text drawn with the standard fonts: the page's hex strings, decoded. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  let text = '';
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const hex of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      text += `${Buffer.from(hex[1]!, 'hex').toString('latin1')}\n`;
    }
  }
  return text;
}

const interFonts = () => ({
  regular: new Uint8Array(readFileSync(join(process.cwd(), 'assets/fonts/Inter-Regular.ttf'))),
  bold: new Uint8Array(readFileSync(join(process.cwd(), 'assets/fonts/Inter-Bold.ttf'))),
});

describe('invoice page', () => {
  it('charges IGST to a buyer in another state and lays the invoice out in order', async () => {
    const text = pdfText(await renderInvoicePdf(invoice(karnataka)));
    const order = [
      'ORIGINAL FOR RECIPIENT',
      'CODEVIBE TECHNOLOGY',
      '06AANCC6406C1ZX',
      'AANCC6406C',
      'hello@codevibe.in',
      'www.codevibe.in',
      'Invoice #:',
      'CV-2026270001',
      'Invoice Date:',
      '23 Nov 2026',
      'Due Date:',
      'Customer Details:',
      'Acme Traders Private Limited',
      'Unregistered',
      'Place of Supply:',
      '29-KARNATAKA',
      'Rate / Item',
      'Aadhaar eSign credits',
      'SAC: 998319',
      'Total Items / Qty : 1 / 50',
      'Taxable Amount',
      'IGST 18.0%',
      'Rs. 2,065.00',
      'Total amount (in words): INR Two Thousand Sixty Five Rupees Only.',
      'Amount Paid',
      'Rs. 2,065.00 Paid via UPI on 23-11-2026 (pay_Qw12ErTy34UiOp)',
      'HSN/SAC',
      'Integrated Tax',
      'TOTAL',
      'Pay using UPI:',
      'Bank Details:',
      'IDFC FIRST Bank',
      '60209181573',
      'IDFB0021003',
      'GURGAON SECTOR FOURTEEN BRANCH',
      'For CODEVIBE TECHNOLOGY',
      'Authorized Signatory',
      'This is a computer generated document.',
    ];
    let from = 0;
    for (const part of order) {
      const at = text.indexOf(part, from);
      expect(at, part).toBeGreaterThanOrEqual(0);
      from = at;
    }
    expect(text).toContain('Rs. 315.00 (18%)');
    expect(text).not.toContain('CGST');
    expect(text).not.toMatch(/cost|markup|leegality/i);
  });

  it('splits the tax into CGST and SGST for a buyer in the seller state', async () => {
    const text = pdfText(await renderInvoicePdf(invoice(haryana)));
    expect(text).toContain('06-HARYANA');
    expect(text).toContain('CGST 9.0%');
    expect(text).toContain('SGST 9.0%');
    expect(text).toContain('Central Tax');
    expect(text).toContain('State/UT Tax');
    expect(text).toContain('Rs. 157.50');
    expect(text).not.toContain('IGST');
  });

  it('leaves out the blocks the operator has not set, and marks a test payment', async () => {
    const bare = { ...seller, upiId: undefined, bank: undefined, phone: undefined };
    const text = pdfText(
      await renderInvoicePdf(invoice(karnataka, { seller: bare, test: true, paymentRef: null })),
    );
    expect(text).not.toContain('Pay using UPI:');
    expect(text).not.toContain('Bank Details:');
    expect(text).not.toContain('Mobile');
    expect(text).not.toContain('Amount Paid');
    expect(text).toContain('Not a tax document');
  });

  it('names an unknown payment method by the payment service', async () => {
    const text = pdfText(await renderInvoicePdf(invoice(karnataka, { paymentMethod: null })));
    expect(text).toContain('Paid via Razorpay on');
  });

  it('draws a name in another script without failing', async () => {
    const buyer = { ...karnataka, legalName: 'आचार्य ट्रेडर्स' };
    await expect(renderInvoicePdf(invoice(buyer))).resolves.toBeInstanceOf(Uint8Array);
    await expect(renderInvoicePdf(invoice(buyer), { fonts: interFonts() })).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });

  it('stays on one page with the shipped fonts and many lines', async () => {
    const lines = Array.from({ length: 6 }, (_, index) => ({
      description: `Codevibe Sign Cloud, 1 month (23 Nov 2026 to 22 Dec 2026), part ${index + 1}`,
      quantity: 1,
      unitPaise: 99_900,
      amountPaise: 99_900,
    }));
    const tax = computeTax({
      taxablePaise: 599_400,
      gstPercent: 18,
      sellerStateCode: '06',
      buyerStateCode: '06',
    });
    const bytes = await renderInvoicePdf(invoice(haryana, { lines, tax }), {
      fonts: interFonts(),
      digitallySigned: true,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('writes the amount in words and shares the tax over the lines to the paisa', () => {
    expect(invoiceAmountInWords(118_050)).toBe(
      'INR One Thousand One Hundred Eighty Rupees and Fifty Paise Only.',
    );
    const lines = [3333, 3333, 3334].map((amountPaise) => ({
      description: 'x',
      quantity: 1,
      unitPaise: amountPaise,
      amountPaise,
    }));
    const tax = computeTax({
      taxablePaise: 10_000,
      gstPercent: 18,
      sellerStateCode: '06',
      buyerStateCode: '29',
    });
    const shares = lineTaxes(lines, tax);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(tax.taxPaise);
    expect(shares).toEqual([600, 600, 600]);
  });
});

describe('invoice rendering of an install', () => {
  it('ships fonts with the rupee sign and seals the file with the install seal', async () => {
    const dev = createDevSeal();
    const dir = mkdtempSync(join(tmpdir(), 'invoice-'));
    const p12 = join(dir, 'seal.p12');
    writeFileSync(p12, dev.p12);
    const rendering = invoiceRendering(config, {
      SEAL_P12_PATH: p12,
      SEAL_PASSPHRASE: dev.passphrase,
      SEAL_ALLOW_WEAK_KEY: false,
    });
    const assets = await rendering.assets();
    expect(assets.fonts).toBeDefined();
    const page = await renderInvoicePdf(invoice(karnataka), { ...assets, digitallySigned: true });
    const sealed = await rendering.seal!(page, new Date());
    expect(await verifySeal(sealed)).toMatchObject({ valid: true, coversWholeDocument: true });

    const samples = process.env.INVOICE_SAMPLE_DIR;
    if (samples) {
      mkdirSync(samples, { recursive: true });
      writeFileSync(join(samples, 'invoice-sample.pdf'), sealed);
      const intra = await renderInvoicePdf(invoice(haryana, { number: 'CV-2026270002' }), {
        ...assets,
        digitallySigned: true,
      });
      writeFileSync(
        join(samples, 'invoice-sample-haryana.pdf'),
        await rendering.seal!(intra, new Date()),
      );
    }
  });
});
