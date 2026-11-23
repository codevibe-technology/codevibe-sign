import 'server-only';
import { z } from 'zod';
import { gstinProblem, stateByCode } from '@/lib/billing/gst';
import { DEFAULT_INVOICE_SERIES, seriesProblem } from '@/lib/billing/invoice-series';
import { parseInr, type Paise } from '@/lib/billing/money';
import type { Plan } from '@/lib/plans';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  /** Null until the webhook is set up; payments are then confirmed from the browser only. */
  webhookSecret: string | null;
  /** From the key id: `rzp_test_` keys never move money. */
  mode: 'test' | 'live';
}

/** Who issues the invoices. Always from configuration, never a built-in default. */
export interface SellerConfig {
  name: string;
  gstin: string;
  cin: string | null;
  address: string;
  /** The first two digits of the GSTIN. */
  stateCode: string;
}

export interface LeegalityConfig {
  authToken: string;
  privateSalt: string;
  workflowId: string;
  environment: 'sandbox' | 'production';
  webhookHeader: { name: string; value: string } | null;
}

export interface HostingOffer {
  name: string;
  url: string;
  note?: string | undefined;
}

export interface BillingConfig {
  razorpay: RazorpayConfig | null;
  seller: SellerConfig | null;
  gstPercent: number;
  sac: string;
  /** Invoice number pattern; see `seriesPrefix`. */
  series: string;
  esign: {
    /** What one eSign costs the operator. Null until it is set; nothing can be bought then. */
    providerCostPaise: Paise | null;
    markupPaise: Paise;
    /** Credits per pack, smallest first. */
    packs: number[];
  };
  cloud: {
    pricePaise: Paise;
    includedMembers: number;
    extraMemberPaise: Paise;
    /** An annual term costs this many months. */
    annualMonths: number;
    graceDays: number;
  };
  installHelpPaise: Paise;
  /** Where notifications for the operator go. */
  operatorEmail: string | null;
  hostingOffers: HostingOffer[];
  /** The operator's own Leegality account, for workspaces that use prepaid credits. */
  leegality: LeegalityConfig | null;
}

type Source = Record<string, string | undefined>;

const read = (source: Source, name: string): string | undefined => {
  const value = source[name]?.trim();
  return value === '' ? undefined : value;
};

function fail(name: string, problem: string): never {
  throw new Error(`${name} ${problem}`);
}

function amount(source: Source, name: string, fallback: string): Paise;
function amount(source: Source, name: string, fallback: null): Paise | null;
function amount(source: Source, name: string, fallback: string | null): Paise | null {
  const raw = read(source, name) ?? fallback;
  if (raw === null) return null;
  const paise = parseInr(raw);
  if (paise === null) {
    fail(name, `must be an amount in rupees with at most two decimals, for example 25 or 24.50`);
  }
  return paise;
}

function whole(source: Source, name: string, fallback: number, min: number, max: number): number {
  const raw = read(source, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    fail(name, `must be a whole number from ${min} to ${max}`);
  }
  return value;
}

/** Every variable of a group, or null when none is set. A partly set group names what is missing. */
function group<K extends string>(
  source: Source,
  required: readonly K[],
  what: string,
): Record<K, string> | null {
  const values = required.map((name) => [name, read(source, name)] as const);
  if (values.every(([, value]) => value === undefined)) return null;
  const missing = values.filter(([, value]) => value === undefined).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} must be set as well to configure ${what}`);
  }
  return Object.fromEntries(values) as Record<K, string>;
}

function razorpay(source: Source): RazorpayConfig | null {
  const keys = group(source, ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] as const, 'Razorpay');
  if (!keys) return null;
  const keyId = keys.RAZORPAY_KEY_ID;
  if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) {
    fail('RAZORPAY_KEY_ID', 'must look like rzp_test_... or rzp_live_...');
  }
  return {
    keyId,
    keySecret: keys.RAZORPAY_KEY_SECRET,
    webhookSecret: read(source, 'RAZORPAY_WEBHOOK_SECRET') ?? null,
    mode: keyId.startsWith('rzp_test_') ? 'test' : 'live',
  };
}

function seller(source: Source): SellerConfig | null {
  const values = group(
    source,
    ['INVOICE_SELLER_NAME', 'INVOICE_SELLER_GSTIN', 'INVOICE_SELLER_ADDRESS'] as const,
    'the invoice seller',
  );
  if (!values) return null;
  const gstin = values.INVOICE_SELLER_GSTIN.toUpperCase();
  const problem = gstinProblem(gstin);
  if (problem) {
    fail(
      'INVOICE_SELLER_GSTIN',
      problem === 'checksum' ? 'does not pass the GSTIN check digit' : 'is not a GSTIN',
    );
  }
  return {
    name: values.INVOICE_SELLER_NAME,
    gstin,
    cin: read(source, 'INVOICE_SELLER_CIN') ?? null,
    address: values.INVOICE_SELLER_ADDRESS,
    stateCode: gstin.slice(0, 2),
  };
}

function leegality(source: Source): LeegalityConfig | null {
  const values = group(
    source,
    ['LEEGALITY_AUTH_TOKEN', 'LEEGALITY_PRIVATE_SALT', 'LEEGALITY_WORKFLOW_ID'] as const,
    'Leegality',
  );
  if (!values) return null;
  const environment = read(source, 'LEEGALITY_ENVIRONMENT') ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') {
    fail('LEEGALITY_ENVIRONMENT', 'must be "sandbox" or "production"');
  }
  const header = group(
    source,
    ['LEEGALITY_WEBHOOK_HEADER_NAME', 'LEEGALITY_WEBHOOK_HEADER_VALUE'] as const,
    'the Leegality webhook header',
  );
  return {
    authToken: values.LEEGALITY_AUTH_TOKEN,
    privateSalt: values.LEEGALITY_PRIVATE_SALT,
    workflowId: values.LEEGALITY_WORKFLOW_ID,
    environment,
    webhookHeader: header
      ? { name: header.LEEGALITY_WEBHOOK_HEADER_NAME, value: header.LEEGALITY_WEBHOOK_HEADER_VALUE }
      : null,
  };
}

function packs(source: Source): number[] {
  const raw = read(source, 'CREDIT_PACKS') ?? '10,50,200';
  const sizes = raw.split(',').map((part) => part.trim());
  if (
    sizes.length === 0 ||
    sizes.length > 8 ||
    !sizes.every((size) => /^[1-9]\d{0,4}$/.test(size))
  ) {
    fail(
      'CREDIT_PACKS',
      'must be up to 8 whole numbers separated by commas, for example 10,50,200',
    );
  }
  return [...new Set(sizes.map(Number))].sort((a, b) => a - b);
}

const offersSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(80),
      url: z.url({ protocol: /^https$/ }),
      note: z.string().trim().max(200).optional(),
    }),
  )
  .max(12);

function hostingOffers(source: Source): HostingOffer[] {
  const raw = read(source, 'HOSTING_OFFERS');
  if (raw === undefined) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    fail('HOSTING_OFFERS', 'must be a JSON list, for example [{"name":"...","url":"https://..."}]');
  }
  const parsed = offersSchema.safeParse(json);
  if (!parsed.success) {
    fail('HOSTING_OFFERS', 'must be a JSON list of { name, url, note } with https links');
  }
  return parsed.data;
}

function gstPercent(source: Source): number {
  const raw = read(source, 'GST_PERCENT') ?? '18';
  const value = Number(raw);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(raw) || value > 40) {
    fail('GST_PERCENT', 'must be a percentage such as 18');
  }
  return value;
}

/**
 * The operator's billing settings, read from the environment on every call. Everything is
 * optional: an install without these variables starts and simply has nothing to sell. A value
 * that is set but malformed throws a message naming its variable.
 */
export function billingConfig(source: Source = process.env): BillingConfig {
  const series = read(source, 'INVOICE_SERIES') ?? DEFAULT_INVOICE_SERIES;
  const problem = seriesProblem(series);
  if (problem) fail('INVOICE_SERIES', problem);
  const sac = read(source, 'INVOICE_SAC') ?? '998319';
  if (!/^\d{4,8}$/.test(sac)) fail('INVOICE_SAC', 'must be a SAC code of 4 to 8 digits');
  const operatorEmail = read(source, 'OPERATOR_EMAIL') ?? null;
  if (operatorEmail && !z.email().safeParse(operatorEmail).success) {
    fail('OPERATOR_EMAIL', 'must be an email address');
  }
  return {
    razorpay: razorpay(source),
    seller: seller(source),
    gstPercent: gstPercent(source),
    sac,
    series,
    esign: {
      providerCostPaise: amount(source, 'ESIGN_PROVIDER_COST_INR', null),
      markupPaise: amount(source, 'ESIGN_MARKUP_INR', '10'),
      packs: packs(source),
    },
    cloud: {
      pricePaise: amount(source, 'CLOUD_PRICE_INR', '999'),
      includedMembers: whole(source, 'CLOUD_INCLUDED_MEMBERS', 25, 1, 100_000),
      extraMemberPaise: amount(source, 'CLOUD_EXTRA_MEMBER_INR', '99'),
      annualMonths: whole(source, 'CLOUD_ANNUAL_MONTHS', 10, 1, 12),
      graceDays: whole(source, 'CLOUD_GRACE_DAYS', 7, 0, 90),
    },
    installHelpPaise: amount(source, 'INSTALL_HELP_PRICE_INR', '1999'),
    operatorEmail,
    hostingOffers: hostingOffers(source),
    leegality: leegality(source),
  };
}

/** The operator's own Leegality account, or null when it is not set up. */
export const platformLeegality = (source: Source = process.env): LeegalityConfig | null =>
  billingConfig(source).leegality;

/** Payments can be taken and invoiced: Razorpay keys and the seller's details are both set. */
export const paymentsConfigured = (
  config: BillingConfig,
): config is BillingConfig & { razorpay: RazorpayConfig; seller: SellerConfig } =>
  config.razorpay !== null && config.seller !== null;

/**
 * What one Aadhaar eSign costs a workspace on `plan`, tax not included, or null while the
 * operator has not set a price. This is the only number about pricing that may reach a
 * customer; how it is made up stays in the operator's configuration.
 */
export function esignPrice(config: BillingConfig, plan: Plan): { pricePaise: Paise } | null {
  const { providerCostPaise, markupPaise } = config.esign;
  if (providerCostPaise === null) return null;
  return { pricePaise: plan === 'free' ? providerCostPaise + markupPaise : providerCostPaise };
}

export type CreditsUnavailable =
  | 'payments_not_configured'
  | 'esign_not_configured'
  | 'price_not_set'
  | 'test_payments';

export interface CreditsOffer {
  /** Null when credits can be bought now. */
  unavailable: CreditsUnavailable | null;
  /** Price of one eSign for this workspace, before tax; null shows as "Price coming soon". */
  pricePaise: Paise | null;
  packs: number[];
  gstPercent: number;
  /** Payments run against Razorpay's test mode; no money moves. */
  testMode: boolean;
}

/**
 * Whether a workspace on `plan` can buy eSign credits, and at what price. Test payment keys
 * together with the production eSign account are refused: a test payment must not buy real
 * eSigns.
 */
export function creditsOffer(config: BillingConfig, plan: Plan): CreditsOffer {
  const price = esignPrice(config, plan);
  const unavailable: CreditsUnavailable | null = !paymentsConfigured(config)
    ? 'payments_not_configured'
    : !config.leegality
      ? 'esign_not_configured'
      : !price
        ? 'price_not_set'
        : config.razorpay.mode === 'test' && config.leegality.environment === 'production'
          ? 'test_payments'
          : null;
  return {
    unavailable,
    pricePaise: price?.pricePaise ?? null,
    packs: config.esign.packs,
    gstPercent: config.gstPercent,
    testMode: config.razorpay?.mode === 'test',
  };
}

/** What to tell someone who cannot buy credits yet. Never mentions how the price is made up. */
export const CREDITS_UNAVAILABLE_MESSAGES: Record<CreditsUnavailable, string> = {
  payments_not_configured: 'Buying credits is not available yet. It is coming soon.',
  esign_not_configured: 'Aadhaar eSign is not available here yet. It is coming soon.',
  price_not_set: 'The price of an Aadhaar eSign has not been published yet. It is coming soon.',
  test_payments:
    'Buying credits is switched off while payments are in test mode. It will be back soon.',
};

export const sellerStateName = (seller: SellerConfig) =>
  stateByCode(seller.stateCode)?.name ?? seller.stateCode;
