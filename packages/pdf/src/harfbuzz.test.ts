import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { subsetFont } from './harfbuzz';
import { bundledFont } from './script-fonts';

const devanagari = () => bundledFont('NotoSansDevanagari-Regular');
const ids = (text: string) =>
  devanagari()
    .hb.shape(text, 'ltr')
    .map((glyph) => glyph.id);

describe('HbFont.shape', () => {
  // Expected glyph ids come from `hb-shape NotoSansDevanagari-Regular.ttf` (HarfBuzz CLI).
  it('forms Devanagari conjuncts as single glyphs', () => {
    expect(ids('क्ष')).toEqual([90]);
    expect(ids('त्र')).toEqual([304]);
    expect(ids('श्री')).toEqual([317, 33]);
  });

  it('draws the i vowel sign before its consonant and keeps both in one cluster', () => {
    const glyphs = devanagari().hb.shape('कि', 'ltr');
    expect(glyphs.map((glyph) => glyph.id)).toEqual([545, 56]);
    expect(glyphs.map((glyph) => glyph.cluster)).toEqual([0, 0]);
  });

  it('joins Arabic letters and returns them in drawing order, right to left', () => {
    const glyphs = bundledFont('NotoSansArabic-Regular').hb.shape('علی', 'rtl');
    expect(glyphs.map((glyph) => glyph.id)).toEqual([104, 70, 49]);
    expect(glyphs.map((glyph) => glyph.cluster)).toEqual([2, 1, 0]);
  });

  it('shapes empty and very long text', () => {
    expect(devanagari().hb.shape('', 'ltr')).toEqual([]);
    const long = 'आशा राव '.repeat(40_000);
    const glyphs = devanagari().hb.shape(long, 'ltr');
    expect(glyphs.length).toBeGreaterThan(200_000);
    expect(glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
  });
});

describe('subsetFont', () => {
  it('keeps only the given glyphs, under their original ids', () => {
    const source = devanagari();
    const subset = subsetFont(source.bytes, [90, 304]);
    expect(subset.byteLength).toBeLessThan(source.bytes.byteLength / 10);
    const font = fontkit.create(subset);
    expect(font.numGlyphs).toBeGreaterThan(304);
    expect(font.getGlyph(90).path.toSVG()).not.toBe('');
    expect(font.getGlyph(304).path.toSVG()).not.toBe('');
    expect(font.getGlyph(56).path.toSVG()).toBe('');
  });

  it('refuses bytes that are not a font', () => {
    expect(() => subsetFont(new Uint8Array([1, 2, 3, 4]), [1])).toThrow(/subset/);
  });
});
