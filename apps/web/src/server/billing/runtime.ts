import 'server-only';
import { env } from '../env';
import { appRuntime } from '../runtime';
import { billingConfig } from './config';
import { fulfilCredits } from './credit-orders';
import { invoiceRendering } from './invoice-assets';
import { registerFulfilment, type BillingDeps } from './orders';
import { createRazorpay } from './razorpay';

/**
 * Settings, payment client, files and mail for the billing code, built from the environment on
 * each call so a changed setting applies without a restart of the module. Also makes sure every
 * kind of order this app sells has its fulfilment registered before a payment can arrive.
 */
export function billingDeps(): BillingDeps {
  registerFulfilment('esign_credits', fulfilCredits);
  const config = billingConfig();
  const { files, mailer } = appRuntime();
  return {
    config,
    razorpay: config.razorpay
      ? createRazorpay({ keyId: config.razorpay.keyId, keySecret: config.razorpay.keySecret })
      : null,
    files,
    mailer,
    now: () => new Date(),
    invoice: invoiceRendering(config, env()),
  };
}
