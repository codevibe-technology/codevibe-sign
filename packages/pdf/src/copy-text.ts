import type { ShapedGlyph } from './harfbuzz';

/** A glyph ready to draw, with the text a reader copies for it. */
export interface PlacedGlyph {
  id: number;
  text: string;
  advance: number;
  xOffset: number;
  yOffset: number;
}

/**
 * Copied for glyphs that stand for no text of their own (a mark drawn off the baseline). A
 * format character: readers drop it instead of inventing a character from the glyph code.
 */
export const NO_TEXT = '\u200b';

/** A character with the marks after it: the smallest piece of a cluster that copies cleanly. */
const BASE_WITH_MARKS = /\P{M}(?:\p{M}|\u200c|\u200d)*|(?:\p{M}|\u200c|\u200d)+/gsu;
const NONSPACING = /\p{Mn}/u;

const onBaseline = (glyph: ShapedGlyph) => glyph.xOffset === 0 && glyph.yOffset === 0;

/** Splits a cluster's text into at least `count` pieces where it can, in typing order. */
function piecesOf(text: string, count: number): string[] {
  const pieces = text.match(BASE_WITH_MARKS) ?? [];
  return pieces.length >= count ? pieces : Array.from(text.normalize('NFD'));
}

/**
 * Decides what each shaped glyph copies as, so that copying or searching the PDF gives back the
 * text as typed:
 *
 * - a cluster's text is handed out in typing order over its glyphs on the baseline, in drawing
 *   order, so a vowel sign drawn before its consonant still copies after it;
 * - marks placed off the baseline copy as nothing;
 * - text that holds a non-spacing mark (a virama, a vowel sign below) is moved onto an extra,
 *   blank glyph of zero width after the visible one. Readers treat a glyph whose text has such a
 *   mark as having no width, which would otherwise scramble the positions of the rest of the word.
 *
 * Right-to-left clusters copy whole on their first glyph.
 */
export function placeGlyphs(
  text: string,
  shaped: ShapedGlyph[],
  rtl: boolean,
  blankGlyph: number,
): PlacedGlyph[] {
  const starts = [...new Set(shaped.map((glyph) => glyph.cluster))].sort((a, b) => a - b);
  const textOf = (cluster: number) => {
    const next = starts.find((start) => start > cluster);
    return text.slice(cluster, next ?? text.length);
  };

  const members = new Map<number, ShapedGlyph[]>();
  for (const glyph of shaped) {
    members.set(glyph.cluster, [...(members.get(glyph.cluster) ?? []), glyph]);
  }
  const texts = new Map<ShapedGlyph, string>();
  for (const [cluster, glyphs] of members) {
    const carriers = glyphs.some(onBaseline) ? glyphs.filter(onBaseline) : glyphs;
    const pieces = rtl ? [textOf(cluster)] : piecesOf(textOf(cluster), carriers.length);
    carriers.forEach((glyph, index) => {
      const last = index === carriers.length - 1;
      texts.set(glyph, (last ? pieces.splice(0) : pieces.splice(0, 1)).join(''));
    });
  }

  return shaped.flatMap((glyph) => {
    const own = texts.get(glyph) || NO_TEXT;
    const place = {
      id: glyph.id,
      advance: glyph.xAdvance,
      xOffset: glyph.xOffset,
      yOffset: glyph.yOffset,
    };
    const split = own.search(NONSPACING);
    if (split <= 0 || blankGlyph === 0 || !onBaseline(glyph)) {
      return [{ ...place, text: own }];
    }
    return [
      { ...place, text: own.slice(0, split) },
      { id: blankGlyph, text: own.slice(split), advance: 0, xOffset: 0, yOffset: 0 },
    ];
  });
}
