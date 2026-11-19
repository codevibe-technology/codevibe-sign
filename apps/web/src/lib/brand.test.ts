import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor, textOn } from './brand';

describe('brand colours', () => {
  it('accepts only #rrggbb', () => {
    expect(isHexColor('#1B6AE0')).toBe(true);
    expect(isHexColor('#1b6ae0')).toBe(true);
    expect(isHexColor('1B6AE0')).toBe(false);
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('red')).toBe(false);
  });

  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('picks the readable text colour', () => {
    expect(textOn('#1B6AE0')).toBe('#FFFFFF');
    expect(textOn('#0D1B2A')).toBe('#FFFFFF');
    expect(textOn('#2DD4BF')).toBe('#0D1B2A');
    expect(textOn('#FFE066')).toBe('#0D1B2A');
  });
});
