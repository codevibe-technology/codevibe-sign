import { describe, expect, it } from 'vitest';
import { stepAt } from './scroll-story';

describe('stepAt', () => {
  it('reads the step from how far the pinned stage has been scrolled', () => {
    expect(stepAt(1000, 1000, 600, 6)).toBe(0);
    expect(stepAt(1600, 1000, 600, 6)).toBe(1);
    expect(stepAt(4000, 1000, 600, 6)).toBe(5);
  });

  it('turns to the next step half way between two', () => {
    expect(stepAt(1290, 1000, 600, 6)).toBe(0);
    expect(stepAt(1310, 1000, 600, 6)).toBe(1);
  });

  it('stays on the first step above the story and on the last below it', () => {
    expect(stepAt(0, 1000, 600, 6)).toBe(0);
    expect(stepAt(9000, 1000, 600, 6)).toBe(5);
    expect(stepAt(5000, 1000, 0, 1)).toBe(0);
  });
});
