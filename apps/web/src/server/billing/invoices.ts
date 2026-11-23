import 'server-only';
import type postgres from 'postgres';
import { formatIstDate } from '@/lib/billing/invoice-series';
import { formatInr } from '@/lib/billing/money';
import { renderInvoicePdf, type InvoiceDocument } from './invoice-pdf';
import { orderFromRow, type BillingDeps, type BillingOrder, type OrderRow } from './orders';

type Sql = postgres.Sql | postgres.TransactionSql;

export interface Invoice {
  id: string;
  number: string;
  issuedAt: Date;
  order: BillingOrder;
  /** When the invoice email went out; null while it is still to be sent. */
  emailedAt: Date | null;
}

interface InvoiceRow extends OrderRow {
  invoice_id: string;
  number: string;
  issued_at: Date;
  file_key: string | null;
  emailed_at: Date | null;
}

const SELECT = (sql: Sql) => sql`
  select o.*, i.id as invoice_id, i.number, i.issued_at, i.file_key, i.emailed_at
  from app_invoices i join app_billing_orders o on o.id = i.order_id`;

const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.invoice_id,
  number: row.number,
  issuedAt: row.issued_at,
  order: orderFromRow(row),
  emailedAt: row.emailed_at,
});

const invoiceFileKey = (invoiceId: string) => `billing/invoices/${invoiceId}.pdf`;

const documentOf = (invoice: Invoice): InvoiceDocument => ({
  number: invoice.number,
  issuedAt: invoice.issuedAt,
  seller: invoice.order.seller,
  buyer: invoice.order.buyer,
  lines: invoice.order.lines,
  sac: invoice.order.sac,
  tax: invoice.order.tax,
  paymentRef: invoice.order.razorpayPaymentId,
  paymentMethod: invoice.order.paymentMethod,
  test: invoice.order.mode === 'test',
});

/** A workspace's invoices, newest first. */
export async function listInvoices(sql: Sql, workspaceId: string, limit = 100): Promise<Invoice[]> {
  const rows = await sql<InvoiceRow[]>`
    ${SELECT(sql)}
    where i.workspace_id = ${workspaceId}
    order by i.issued_at desc, i.number desc
    limit ${Math.min(Math.max(limit, 1), 500)}`;
  return rows.map(toInvoice);
}

/** One invoice of a workspace; null for an invoice that is not this workspace's. */
export async function getInvoice(
  sql: Sql,
  workspaceId: string | null,
  invoiceId: string,
): Promise<Invoice | null> {
  const [row] = await sql<InvoiceRow[]>`
    ${SELECT(sql)}
    where i.id = ${invoiceId} and i.workspace_id is not distinct from ${workspaceId}`;
  return row ? toInvoice(row) : null;
}

/**
 * The invoice file with the install's fonts and images, sealed when the install has a seal.
 * A seal that fails does not hold the invoice back: the file is then made without one and
 * says so in its footer.
 */
async function renderSigned(deps: BillingDeps, document: InvoiceDocument): Promise<Uint8Array> {
  const assets = (await deps.invoice?.assets()) ?? {};
  const seal = deps.invoice?.seal;
  if (seal && !document.test) {
    try {
      const page = await renderInvoicePdf(document, { ...assets, digitallySigned: true });
      return await seal(page, document.issuedAt);
    } catch (err) {
      console.error('[billing] invoice seal', err instanceof Error ? err.message : err);
    }
  }
  return renderInvoicePdf(document, assets);
}

async function storedPdf(sql: Sql, deps: BillingDeps, row: InvoiceRow): Promise<Uint8Array> {
  if (row.file_key) {
    const stored = await deps.files.get(row.file_key);
    if (stored) return stored;
  }
  const bytes = await renderSigned(deps, documentOf(toInvoice(row)));
  const key = invoiceFileKey(row.invoice_id);
  await deps.files.put(key, bytes, 'application/pdf');
  await sql`update app_invoices set file_key = ${key} where id = ${row.invoice_id}`;
  return bytes;
}

/**
 * The invoice as a PDF, for a member of its workspace to download. The file is made on first
 * use and kept; an invoice is never rendered from anything but its own stored figures.
 */
export async function invoicePdf(
  sql: Sql,
  deps: BillingDeps,
  workspaceId: string | null,
  invoiceId: string,
): Promise<{ number: string; bytes: Uint8Array } | null> {
  const [row] = await sql<InvoiceRow[]>`
    ${SELECT(sql)}
    where i.id = ${invoiceId} and i.workspace_id is not distinct from ${workspaceId}`;
  return row ? { number: row.number, bytes: await storedPdf(sql, deps, row) } : null;
}

const MAX_ATTEMPTS = 8;
const CLAIM_MINUTES = 5;

function invoiceEmail(invoice: Invoice) {
  const { order } = invoice;
  const test = order.mode === 'test';
  const what = test ? 'Test invoice' : 'Tax invoice';
  const lines = order.lines.map((line) => `  ${line.description}`).join('\n');
  return {
    subject: `${what} ${invoice.number} from ${order.seller.name}`,
    text: [
      `Hello,`,
      ``,
      `Thank you for your payment. ${what} ${invoice.number} dated ${formatIstDate(invoice.issuedAt)} is attached.`,
      ``,
      lines,
      ``,
      `Total paid, GST included: ${formatInr(order.tax.totalPaise)}`,
      ...(order.razorpayPaymentId ? [`Payment reference: ${order.razorpayPaymentId}`] : []),
      ...(test ? [``, `This payment used test keys. No money was paid.`] : []),
      ``,
      order.seller.name,
    ].join('\n'),
  };
}

/**
 * Renders, stores and emails one invoice. Only one caller at a time works on an invoice, and
 * the email goes out once. Throws when a step fails; the invoice stays to be finished later.
 */
export async function finishInvoice(
  sql: postgres.Sql,
  deps: BillingDeps,
  invoiceId: string,
): Promise<boolean> {
  const now = deps.now();
  const stale = new Date(now.getTime() - CLAIM_MINUTES * 60_000);
  const [claimed] = await sql`
    update app_invoices
    set attempts = attempts + 1, claimed_at = ${now}
    where id = ${invoiceId} and emailed_at is null and attempts < ${MAX_ATTEMPTS}
      and (claimed_at is null or claimed_at < ${stale})
    returning id`;
  if (!claimed) return false;
  try {
    const [row] = await sql<InvoiceRow[]>`${SELECT(sql)} where i.id = ${invoiceId}`;
    const invoice = toInvoice(row!);
    const bytes = await storedPdf(sql, deps, row!);
    await deps.mailer.send({
      to: invoice.order.buyer.email,
      fromName: invoice.order.seller.name,
      ...invoiceEmail(invoice),
      attachments: [
        { filename: `${invoice.number}.pdf`, content: bytes, contentType: 'application/pdf' },
      ],
      meta: {
        kind: 'invoice',
        ...(invoice.order.workspaceId ? { workspaceId: invoice.order.workspaceId } : {}),
      },
    });
    await sql`
      update app_invoices set emailed_at = ${deps.now()}, claimed_at = null, last_error = null
      where id = ${invoiceId}`;
    return true;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await sql`
      update app_invoices set claimed_at = null, last_error = ${message} where id = ${invoiceId}`;
    throw err;
  }
}

/**
 * Finishes invoices whose file or email failed earlier. Safe to run from every process on a
 * timer: each invoice is claimed before it is worked on. Returns how many were sent.
 */
export async function finishPendingInvoices(sql: postgres.Sql, deps: BillingDeps): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    select id from app_invoices
    where emailed_at is null and attempts < ${MAX_ATTEMPTS}
    order by issued_at
    limit 20`;
  let sent = 0;
  for (const row of rows) {
    const done = await finishInvoice(sql, deps, row.id).catch((err: unknown) => {
      console.error('[billing] invoice', err instanceof Error ? err.message : err);
      return false;
    });
    if (done) sent += 1;
  }
  return sent;
}
