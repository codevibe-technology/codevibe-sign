import 'server-only';
import type postgres from 'postgres';
import type { BillingDetails } from '@/lib/billing/details';
import type { Paise } from '@/lib/billing/money';
import type { Plan } from '@/lib/plans';
import { creditsOffer, type BillingConfig, type CreditsOffer } from './config';
import { creditBalance, type CreditBalance } from './credits';
import { getBillingDetails } from './details';
import { listInvoices, type Invoice } from './invoices';
import type { OrderKind } from './orders';

type Sql = postgres.Sql | postgres.TransactionSql;

/** An invoice as a list shows it. Plain data, safe to hand to the browser. */
export interface InvoiceSummary {
  id: string;
  number: string;
  issuedAt: string;
  kind: OrderKind;
  /** The first line of the invoice. */
  description: string;
  taxablePaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  test: boolean;
}

export const summarizeInvoice = (invoice: Invoice): InvoiceSummary => ({
  id: invoice.id,
  number: invoice.number,
  issuedAt: invoice.issuedAt.toISOString(),
  kind: invoice.order.kind,
  description: invoice.order.lines[0]?.description ?? '',
  taxablePaise: invoice.order.tax.taxablePaise,
  taxPaise: invoice.order.tax.taxPaise,
  totalPaise: invoice.order.tax.totalPaise,
  test: invoice.order.mode === 'test',
});

export interface BillingOverview {
  details: BillingDetails | null;
  credits: CreditBalance;
  offer: CreditsOffer;
  invoices: InvoiceSummary[];
}

/** Everything the billing and eSign credit pages show for one workspace. */
export async function billingOverview(
  sql: Sql,
  config: BillingConfig,
  input: { workspaceId: string; plan: Plan },
): Promise<BillingOverview> {
  const [details, credits, invoices] = await Promise.all([
    getBillingDetails(sql, input.workspaceId),
    creditBalance(sql, input.workspaceId),
    listInvoices(sql, input.workspaceId),
  ]);
  return {
    details,
    credits,
    offer: creditsOffer(config, input.plan),
    invoices: invoices.map(summarizeInvoice),
  };
}
