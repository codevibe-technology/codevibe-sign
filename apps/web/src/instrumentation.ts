/**
 * Runs once per server process: migrates when `AUTO_MIGRATE` is on, then runs the sign
 * server's `tick()` (reminders, expiry, retries) on a timer when a seal key is configured.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startBackground } = await import('./server/background');
  await startBackground();
}
