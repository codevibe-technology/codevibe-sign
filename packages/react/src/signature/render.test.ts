import { describe, expect, it } from 'vitest';
import { defaultSignatureFonts, SCRIPT_FALLBACK_FONTS } from './render';

describe('defaultSignatureFonts', () => {
  it('fall back to faces for Indian scripts and Arabic before the generic family', () => {
    for (const font of defaultSignatureFonts) {
      expect(font.family).toContain(SCRIPT_FALLBACK_FONTS);
      expect(font.family.indexOf('"Nirmala UI"')).toBeLessThan(font.family.lastIndexOf(','));
      expect(font.family).toMatch(/, (cursive|serif)$/);
    }
  });

  it('name a face for every script the PDF certificate draws', () => {
    for (const face of [
      'Devanagari',
      'Tamil',
      'Telugu',
      'Kannada',
      'Malayalam',
      'Bengali',
      'Gujarati',
      'Gurmukhi',
      'Oriya',
      'Arabic',
    ]) {
      expect(SCRIPT_FALLBACK_FONTS).toContain(face);
    }
  });
});
