import type { Effect, Envelope } from '@codevibe_technology/sign-core';
import type { Job } from '../store/types';
import type { Runtime } from './context';
import { runNotify, type NotifyPayload } from './notify';
import { runSeal, type SealPayload } from './seal';
import { buildWebhookBody, deliverWebhook, type WebhookPayload } from './webhooks';

/** How long a claimed job is hidden from other workers. */
export const JOB_LEASE_MS = 5 * 60 * 1000;
/** Delay before each retry; a job that fails once more than this list is long is dropped. */
export const RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
];

/**
 * Turns transition effects into jobs. Completion copies wait for the seal job so the
 * sealed files can be attached. Jobs start leased, because the request that created
 * them runs them straight away; `tick()` picks them up only if that run never finishes.
 */
export function effectsToJobs(rt: Runtime, envelope: Envelope, effects: Effect[]): Job[] {
  const now = rt.clock.now();
  const job = (kind: Job['kind'], payload: object) => makeJob(rt, kind, payload);

  const sealing = effects.some((e) => e.kind === 'seal');
  const afterSeal: NotifyPayload[] = [];
  const jobs: Job[] = [];
  for (const effect of effects) {
    if (effect.kind === 'notify') {
      const payload: NotifyPayload = {
        envelopeId: envelope.id,
        recipientId: effect.recipientId,
        reason: effect.reason,
      };
      if (effect.reason === 'completed_copy' && sealing) afterSeal.push(payload);
      else jobs.push(job('notify', payload));
    } else if (effect.kind === 'webhook') {
      for (const target of rt.webhooks) {
        if (!target.events.includes('*') && !target.events.includes(effect.event)) continue;
        const deliveryId = rt.ids.id();
        const payload: WebhookPayload = {
          url: target.url,
          deliveryId,
          body: buildWebhookBody(deliveryId, effect.event, envelope, now),
        };
        jobs.push(job('webhook', payload));
      }
    }
  }
  if (sealing) {
    const payload: SealPayload = { envelopeId: envelope.id, afterSeal };
    jobs.unshift(job('seal', payload));
  }
  return jobs;
}

export async function dispatchJobs(rt: Runtime, jobs: Job[]): Promise<void> {
  if (jobs.length === 0) return;
  if (rt.effects === 'await') {
    await runJobs(rt, jobs);
    return;
  }
  const run = runJobs(rt, jobs)
    .catch((err: unknown) => rt.logger.error('background jobs failed', { error: describe(err) }))
    .finally(() => rt.inflight.delete(run));
  rt.inflight.add(run);
}

export async function runJobs(rt: Runtime, jobs: Job[]): Promise<number> {
  let failed = 0;
  for (const job of jobs) {
    if (!(await runJob(rt, job))) failed++;
  }
  return failed;
}

async function runJob(rt: Runtime, job: Job): Promise<boolean> {
  try {
    await handle(rt, job);
    await rt.store.completeJob(job.id);
    return true;
  } catch (err) {
    const delay = RETRY_DELAYS_MS[job.attempts];
    const retryAt = delay === undefined ? null : new Date(rt.clock.now().getTime() + delay);
    await rt.store.failJob(job.id, describe(err), retryAt);
    const meta = { job: job.id, kind: job.kind, attempt: job.attempts + 1, error: describe(err) };
    if (retryAt) rt.logger.warn('job failed, will retry', meta);
    else rt.logger.error('job failed for the last time', meta);
    return false;
  }
}

function handle(rt: Runtime, job: Job): Promise<void> {
  switch (job.kind) {
    case 'notify':
      return runNotify(rt, job.payload as unknown as NotifyPayload);
    case 'webhook':
      return deliverWebhook(rt, job.payload as unknown as WebhookPayload);
    case 'seal':
      return runSeal(rt, job.payload as unknown as SealPayload, (more) =>
        rt.store.enqueue(more).then(() => dispatchJobs(rt, more)),
      );
  }
}

export function makeJob(rt: Runtime, kind: Job['kind'], payload: object, leased = true): Job {
  const now = rt.clock.now().getTime();
  return {
    id: rt.ids.id(),
    kind,
    payload: { ...payload },
    attempts: 0,
    runAt: new Date(leased ? now + JOB_LEASE_MS : now),
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
