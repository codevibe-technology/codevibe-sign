import { describe, expect, it } from 'vitest';
import { NO_TEXT, placeGlyphs } from './copy-text';
import type { ShapedGlyph } from './harfbuzz';

const glyph = (id: number, cluster: number, extra: Partial<ShapedGlyph> = {}): ShapedGlyph => ({
  id,
  cluster,
  xAdvance: 500,
  xOffset: 0,
  yOffset: 0,
  ...extra,
});
const BLANK = 3;
const texts = (placed: { text: string }[]) => placed.map((entry) => entry.text);
const copied = (placed: { text: string }[]) => texts(placed).join('').replaceAll(NO_TEXT, '');

describe('placeGlyphs', () => {
  it('hands a cluster out in typing order over glyphs in drawing order', () => {
    // कि: the vowel sign is drawn first, the consonant second.
    const placed = placeGlyphs('कि', [glyph(545, 0), glyph(56, 0)], false, BLANK);
    expect(texts(placed)).toEqual(['क', 'ि']);
  });

  it('gives each glyph its own letter when a cluster has as many pieces', () => {
    const placed = placeGlyphs('ab', [glyph(1, 0), glyph(2, 0)], false, BLANK);
    expect(texts(placed)).toEqual(['a', 'b']);
  });

  it('moves text with a non-spacing mark onto a blank glyph of no width', () => {
    const placed = placeGlyphs('क्ष', [glyph(90, 0)], false, BLANK);
    expect(placed).toEqual([
      { id: 90, text: 'क', advance: 500, xOffset: 0, yOffset: 0 },
      { id: BLANK, text: '्ष', advance: 0, xOffset: 0, yOffset: 0 },
    ]);
  });

  it('keeps the mark on the glyph when the font has no blank glyph', () => {
    expect(texts(placeGlyphs('क्ष', [glyph(90, 0)], false, 0))).toEqual(['क्ष']);
  });

  it('copies marks drawn off the baseline as nothing', () => {
    const mark = glyph(70, 0, { xAdvance: 0, xOffset: -120, yOffset: -40 });
    const placed = placeGlyphs('कु', [glyph(56, 0), mark], false, BLANK);
    expect(placed.find((entry) => entry.id === 70)?.text).toBe(NO_TEXT);
    expect(copied(placed)).toBe('कु');
  });

  it('splits a composed vowel sign when a cluster has more glyphs than pieces', () => {
    // கொ: one vowel sign drawn on both sides of the consonant.
    const placed = placeGlyphs('கொ', [glyph(1, 0), glyph(2, 0), glyph(3, 0)], false, BLANK);
    expect(copied(placed).normalize('NFC')).toBe('கொ');
    expect(texts(placed)).not.toContain(NO_TEXT);
  });

  it('copies a right-to-left cluster whole on its first glyph', () => {
    const placed = placeGlyphs('لا', [glyph(9, 0), glyph(8, 0)], true, BLANK);
    expect(texts(placed)).toEqual(['لا', NO_TEXT]);
  });

  it('keeps clusters apart', () => {
    const placed = placeGlyphs('ab', [glyph(1, 0), glyph(2, 1)], false, BLANK);
    expect(texts(placed)).toEqual(['a', 'b']);
  });
});
