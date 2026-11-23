import { describe, expect, it } from 'vitest';
import { stepAt } from './scroll-story';

describe('stepAt', () => {
  it('picks the last step whose top has passed the reading line', () => {
    expect(stepAt([100, 900, 1700], 450)).toBe(0);
    expect(stepAt([-700, 100, 900], 450)).toBe(1);
    expect(stepAt([-1500, -700, 100], 450)).toBe(2);
  });

  it('stays on the first step until the story reaches the line', () => {
    expect(stepAt([600, 1400], 450)).toBe(0);
  });
});
