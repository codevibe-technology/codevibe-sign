type Flush = () => Promise<unknown>;

const flushes = new Set<Flush>();

/**
 * Registers work to finish before an automatic sign-out, such as a draft's pending save.
 * Returns the function that removes it again.
 */
export function onBeforeSignOut(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/**
 * Runs every registered flush and waits for them, but never longer than `timeoutMs`: a save
 * that hangs must not keep an unattended screen signed in. Failures are ignored here; the
 * page that registered the work shows its own errors.
 */
export async function flushBeforeSignOut(timeoutMs = 5000): Promise<void> {
  if (flushes.size === 0) return;
  const all = Promise.allSettled([...flushes].map((flush) => flush()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([all, timeout]);
  clearTimeout(timer);
}
