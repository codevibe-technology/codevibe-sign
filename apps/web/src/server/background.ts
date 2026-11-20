import { db } from './db';
import { env } from './env';
import { migrateAll } from './migrate';
import { resumeBulkSends } from './bulk-worker';
import { pruneMailLog } from './mail-log';
import { signServer } from './sign/server';
import { pruneDeliveries } from './webhooks';

export async function startBackground() {
  const config = env();
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
  }, config.SIGN_TICK_SECONDS * 1000);
  timer.unref();
}
