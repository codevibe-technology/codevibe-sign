import { tick as coreTick } from '@codevibe_technology/sign-core';
import type { Runtime } from './context';
import { JOB_LEASE_MS, runJobs } from './jobs';
import { mutate } from './mutate';
import { IDEMPOTENCY_TTL_MS } from '../http/idempotency';

/** Safety net: an envelope that turned out to have nothing due is not looked at again for this long. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface TickResult {
  /** Envelopes looked at for reminders and expiry. */
  envelopes: number;
  /** Envelopes that changed (a reminder went out, or it expired). */
  changed: number;
  jobs: number;
  failedJobs: number;
}

export interface TickOptions {
  envelopeBatch?: number;
  jobBatch?: number;
}

export async function tick(rt: Runtime, options: TickOptions = {}): Promise<TickResult> {
  const now = rt.clock.now();
  const due = await rt.store.due(now, options.envelopeBatch ?? 100);
  let changed = 0;
  for (const candidate of due) {
    try {
      const result = await mutate(rt, candidate.id, (envelope) => coreTick(envelope, now));
      if (result.changed) {
        changed++;
        continue;
      }
      const expiry = candidate.expiresAt ? new Date(candidate.expiresAt).getTime() : Infinity;
      await rt.store.deferCheck(
        candidate.id,
        new Date(
          Math.min(now.getTime() + CHECK_INTERVAL_MS, Math.max(expiry, now.getTime() + 1000)),
        ),
      );
    } catch (err) {
      rt.logger.error('envelope check failed', {
        envelope: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const jobs = await rt.store.claimJobs(
    now,
    options.jobBatch ?? 50,
    new Date(now.getTime() + JOB_LEASE_MS),
  );
  const failedJobs = await runJobs(rt, jobs);
  await rt.store.purge(now, new Date(now.getTime() - IDEMPOTENCY_TTL_MS));
  return { envelopes: due.length, changed, jobs: jobs.length, failedJobs };
}
