import 'server-only';
import { env } from '../env';
import { appRuntime } from '../runtime';
import { billingConfig } from './config';
import { reverseCredits } from './credit-adjust';
import { fulfilCredits } from './credit-orders';
import { fulfilInstallHelp } from './install-help';
import { invoiceRendering } from './invoice-assets';
import { registerFulfilment, registerReversal, type BillingDeps } from './orders';
import { createRazorpay } from './razorpay';
import {
  fulfilSeats,
  fulfilSubscription,
  reverseSeats,
  reverseSubscription,
} from './subscriptions';

/**
 * Settings, payment client, files and mail for the billing code, built from the environment on
 * each call so a changed setting applies without a restart of the module. Also makes sure every
 * kind of order this app sells has its fulfilment registered before a payment can arrive.
 */
export function billingDeps(): BillingDeps {
  registerFulfilment('esign_credits', fulfilCredits);
  registerFulfilment('cloud_subscription', fulfilSubscription);
  registerFulfilment('extra_seats', fulfilSeats);
  registerFulfilment('install_help', fulfilInstallHelp);
  registerReversal('esign_credits', reverseCredits);
  registerReversal('cloud_subscription', reverseSubscription);
  registerReversal('extra_seats', reverseSeats);
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
    appUrl: env().APP_URL,
    invoice: invoiceRendering(config, env()),
  };
}
