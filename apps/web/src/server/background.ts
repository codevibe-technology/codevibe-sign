import { db } from './db';
import { env } from './env';
import { migrateAll } from './migrate';
import { signServer } from './sign/server';

export async function startBackground() {
  const config = env();
  if (config.AUTO_MIGRATE) {
    const applied = await migrateAll(db());
    if (applied.length) console.log(`[migrate] applied ${applied.join(', ')}`);
  }
  if (!config.SEAL_P12_PATH || config.SIGN_TICK_SECONDS === 0) return;
  const timer = setInterval(() => {
    signServer()
      .tick()
      .catch((err: unknown) =>
        console.error('[tick] failed', err instanceof Error ? err.message : err),
      );
  }, config.SIGN_TICK_SECONDS * 1000);
  timer.unref();
}
