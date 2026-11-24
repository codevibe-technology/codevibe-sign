import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushBeforeSignOut, onBeforeSignOut } from './before-sign-out';

afterEach(() => {
  vi.useRealTimers();
});

describe('flushBeforeSignOut', () => {
  it('waits for every registered save, and skips one removed again', async () => {
    const done: string[] = [];
    const removeA = onBeforeSignOut(async () => void done.push('draft'));
    const removeB = onBeforeSignOut(async () => void done.push('gone'));
    removeB();
    await flushBeforeSignOut();
    expect(done).toEqual(['draft']);
    removeA();
  });

  it('carries on when a save fails', async () => {
    const remove = onBeforeSignOut(async () => {
      throw new Error('offline');
    });
    await expect(flushBeforeSignOut()).resolves.toBeUndefined();
    remove();
  });

  it('gives up on a save that hangs, so the screen still signs out', async () => {
    vi.useFakeTimers();
    const remove = onBeforeSignOut(() => new Promise(() => undefined));
    let finished = false;
    const flushing = flushBeforeSignOut(5000).then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flushing;
    expect(finished).toBe(true);
    remove();
  });
});
