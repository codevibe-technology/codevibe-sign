import { db } from './db';
import { env } from './env';
import { migrateAll } from './migrate';
import { notifyInstallBookings } from './billing/install-help';
import { voidTestCredits } from './billing/credit-adjust';
import { finishPendingInvoices } from './billing/invoices';
import { sendOperatorNotices } from './billing/notices';
import { expireOrders, pruneRazorpayEvents } from './billing/orders';
import { billingDeps } from './billing/runtime';
import { runSubscriptionTick } from './billing/subscriptions';
import { resumeBulkSends } from './bulk-worker';
import { pruneMailLog } from './mail-log';
import { signServer } from './sign/server';
import { pruneDeliveries } from './webhooks';

/**
 * Sends invoices whose file or email failed earlier, moves Cloud subscriptions along with the
 * clock, tells the operator about paid bookings and forgets old payment notifications.
 */
async function billingTick() {
  const deps = billingDeps();
  await finishPendingInvoices(db(), deps);
  await runSubscriptionTick(db(), deps);
  await notifyInstallBookings(db(), deps);
  await expireOrders(db(), deps);
  if (deps.config.live) await voidTestCredits(db(), deps.now());
  await sendOperatorNotices(db(), {
    mailer: deps.mailer,
    operatorEmail: deps.config.operatorEmail,
    now: deps.now,
    ...(deps.appUrl ? { appUrl: deps.appUrl } : {}),
  });
  await pruneRazorpayEvents(db());
}

/** Says in the server log, once at start, which billing setting is wrong; nowhere public. */
function reportBillingSettings() {
  try {
    for (const problem of billingDeps().config.problems) console.error('[billing]', problem);
  } catch (err) {
    console.error('[billing]', err instanceof Error ? err.message : err);
  }
}

export async function startBackground() {
  const config = env();
  reportBillingSettings();
  if (config.AUTO_MIGRATE) {
    const applied = await migrateAll(db());
    if (applied.length) console.log(`[migrate] applied ${applied.join(', ')}`);
  }
  if (!config.SEAL_P12_PATH || config.SIGN_TICK_SECONDS === 0) return;
  const report = (what: string) => (err: unknown) =>
    console.error(`[${what}] failed`, err instanceof Error ? err.message : err);
  const timer = setInterval(() => {
    signServer().tick().catch(report('tick'));
    resumeBulkSends().catch(report('bulk'));
    pruneDeliveries(db()).catch(report('webhook log'));
    pruneMailLog(db()).catch(report('mail log'));
    billingTick().catch(report('billing'));
  }, config.SIGN_TICK_SECONDS * 1000);
  timer.unref();
}
