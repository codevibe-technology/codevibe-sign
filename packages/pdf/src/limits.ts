import { Worker } from 'node:worker_threads';
import { SignError } from '@codevibe_technology/sign-core';
import workerSource from 'virtual:limits-worker';
import type { WorkerInput, WorkerVerdict } from './limits-worker';

/** Bounds on the work one PDF may cost to read. */
export interface ParseLimits {
  /** Most pages. Default 500. */
  maxPages: number;
  /** Most indirect objects. Default 100 000. */
  maxObjects: number;
  /** Deepest nesting of arrays and dictionaries, and of the page tree. Default 64. */
  maxDepth: number;
  /** Most bytes all compressed streams may inflate to, together. Default 50 MB. */
  maxDecodedBytes: number;
  /** Wall-clock budget for reading the file; the worker is killed after it. Default 10 s. */
  timeoutMs: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  maxPages: 500,
  maxObjects: 100_000,
  maxDepth: 64,
  maxDecodedBytes: 50 * 1024 * 1024,
  timeoutMs: 10_000,
};

/** Heap for the inspection worker; a file that needs more is refused. */
const WORKER_HEAP_MB = 512;

export type LimitName = Exclude<keyof ParseLimits, 'timeoutMs'>;

const LIMIT_MESSAGES: Record<LimitName, (max: number) => string> = {
  maxPages: (max) => `The PDF has more than ${max} pages.`,
  maxObjects: (max) => `The PDF has more than ${max} objects.`,
  maxDepth: (max) => `The PDF nests objects more than ${max} levels deep.`,
  maxDecodedBytes: (max) => `The PDF's compressed content expands to more than ${max} bytes.`,
};

function limitError(limit: LimitName, max: number): SignError {
  return new SignError('DOCUMENT_INVALID', `${LIMIT_MESSAGES[limit](max)} It cannot be used.`, {
    reason: 'limit',
    limit,
    max,
  });
}

type Outcome =
  | { kind: 'verdict'; verdict: WorkerVerdict }
  | { kind: 'timeout' }
  | { kind: 'out-of-memory' }
  | { kind: 'failed'; cause: unknown };

function runWorker(input: WorkerInput, timeoutMs: number): Promise<Outcome> {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  });
  return new Promise<Outcome>((resolve) => {
    const finish = (outcome: Outcome) => {
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    worker.once('message', (verdict: WorkerVerdict) => finish({ kind: 'verdict', verdict }));
    worker.once('error', (error: Error & { code?: string }) =>
      finish(
        error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? { kind: 'out-of-memory' }
          : { kind: 'failed', cause: error },
      ),
    );
    worker.once('exit', (code) =>
      finish({ kind: 'failed', cause: new Error(`The worker exited with code ${code}.`) }),
    );
  });
}

/**
 * Reads the file in a worker thread under `limits` and throws `DOCUMENT_INVALID` when it goes
 * over one, runs out of time (the worker is terminated) or exhausts the worker's memory. A file
 * that passes can then be parsed on the main thread at a bounded cost. If the worker itself
 * cannot run, a plain `Error` is thrown: that is a fault of the host, not of the file.
 */
export async function checkParseLimits(
  bytes: Uint8Array,
  overrides: Partial<ParseLimits> = {},
): Promise<void> {
  const limits: ParseLimits = { ...DEFAULT_PARSE_LIMITS, ...overrides };
  const outcome = await runWorker({ bytes, limits }, limits.timeoutMs);

  switch (outcome.kind) {
    case 'timeout':
      throw new SignError(
        'DOCUMENT_INVALID',
        `The PDF took longer than ${limits.timeoutMs} ms to read. It cannot be used.`,
        { reason: 'timeout', timeoutMs: limits.timeoutMs },
      );
    case 'out-of-memory':
      throw new SignError('DOCUMENT_INVALID', 'The PDF needs too much memory to read.', {
        reason: 'limit',
        limit: 'memory',
      });
    case 'failed':
      throw new Error('The PDF check could not run its worker thread.', { cause: outcome.cause });
    case 'verdict': {
      const { verdict } = outcome;
      if (verdict.ok) {
        return;
      }
      if ('cycle' in verdict) {
        throw new SignError('DOCUMENT_INVALID', 'The PDF could not be read. It may be damaged.', {
          reason: 'unreadable',
        });
      }
      throw limitError(verdict.limit, limits[verdict.limit]);
    }
  }
}
