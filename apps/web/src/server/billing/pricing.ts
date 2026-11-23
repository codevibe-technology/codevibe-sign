import 'server-only';
import { formatInr } from '@/lib/billing/money';
import type { Plan } from '@/lib/plans';
import {
  billingConfig,
  esignPrice,
  paymentsConfigured,
  type BillingConfig,
  type HostingOffer,
} from './config';
import { planPrices } from './subscriptions';

/** Shown wherever a price has not been published yet. */
export const PRICE_COMING_SOON = 'Price coming soon';

/** `₹35 per eSign`, or that the price is coming. The only eSign pricing a customer reads. */
export function esignPriceText(config: BillingConfig, plan: Plan): string {
  const price = esignPrice(config, plan);
  return price ? `${formatInr(price.pricePaise)} per eSign` : PRICE_COMING_SOON;
}

/**
 * Every price the public pages and the plan page print, as finished text. Built on the server
 * and safe to hand to the browser: it holds what a customer pays and nothing about how a
 * price is made up.
 */
export interface PricingView {
  cloudMonth: string;
  cloudYear: string;
  /** For example `2 months free`; null when a year costs twelve months. */
  yearSaving: string | null;
  extraMember: string;
  includedMembers: number;
  esignFree: string;
  esignCloud: string;
  installHelp: string;
  gstPercent: number;
  graceDays: number;
  /** Payments can be taken on this install. */
  paymentsOpen: boolean;
  /** Payments run on test keys; no money moves. */
  testMode: boolean;
  operatorEmail: string | null;
  hostingOffers: HostingOffer[];
}

export function pricingView(config: BillingConfig): PricingView {
  const prices = planPrices(config);
  const freeMonths = 12 - prices.annualMonths;
  return {
    cloudMonth: formatInr(prices.monthPaise),
    cloudYear: formatInr(prices.yearPaise),
    yearSaving:
      freeMonths > 0 ? `${freeMonths} ${freeMonths === 1 ? 'month' : 'months'} free` : null,
    extraMember: formatInr(prices.seatMonthPaise),
    includedMembers: prices.includedMembers,
    esignFree: esignPriceText(config, 'free'),
    esignCloud: esignPriceText(config, 'cloud'),
    installHelp: formatInr(config.installHelpPaise),
    gstPercent: config.gstPercent,
    graceDays: prices.graceDays,
    paymentsOpen: paymentsConfigured(config),
    testMode: config.razorpay?.mode === 'test',
    operatorEmail: config.operatorEmail,
    hostingOffers: config.hostingOffers,
  };
}

/**
 * The pricing of this install. A mistake in a billing setting must not take a public page
 * down, so a configuration that cannot be read shows the default prices with payments closed.
 */
export function currentPricing(source: Record<string, string | undefined> = process.env) {
  try {
    return pricingView(billingConfig(source));
  } catch (err) {
    console.error('[billing] settings', err instanceof Error ? err.message : err);
    return { ...pricingView(billingConfig({})), paymentsOpen: false, testMode: false };
  }
}
