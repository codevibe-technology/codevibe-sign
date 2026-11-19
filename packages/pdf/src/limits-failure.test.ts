import { describe, expect, it, vi } from 'vitest';
import { SignError } from '@codevibe_technology/sign-core';
import { checkParseLimits } from './limits';
import { A4, makePdf } from './testing/fixtures';

const worker = vi.hoisted(() => ({ source: '' }));

vi.mock('virtual:limits-worker', () => ({
  get default() {
    return worker.source;
  },
}));

async function failure(source: string): Promise<unknown> {
  worker.source = source;
  return checkParseLimits(await makePdf([{ size: A4 }])).then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('checkParseLimits when the worker cannot run', () => {
  it('reports a worker that fails to start as a host fault, not a bad file', async () => {
    const error = await failure('require("a-module-that-is-not-installed")');
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SignError);
    expect((error as Error).message).toBe('The PDF check could not run its worker thread.');
    expect(((error as Error).cause as { code?: string }).code).toBe('MODULE_NOT_FOUND');
  });

  it('reports a worker that exits without a verdict as a host fault', async () => {
    const error = await failure('process.exit(3)');
    expect(error).not.toBeInstanceOf(SignError);
    expect(((error as Error).cause as Error).message).toBe('The worker exited with code 3.');
  });
});
