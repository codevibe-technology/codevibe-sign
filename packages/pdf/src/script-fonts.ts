import { brotliDecompressSync } from 'node:zlib';
import fontkit, { type Font } from '@pdf-lib/fontkit';
import { fonts as packedFonts } from 'virtual:font-assets';
import { HbFont } from './harfbuzz';

/** A TrueType font that can shape text: HarfBuzz picks and places the glyphs, fontkit reads metrics. */
export interface ShapingFont {
  /** PostScript name, used for the embedded font's /BaseFont. */
  name: string;
  /** The font file, subset when a document embeds it. */
  bytes: Uint8Array;
  font: Font;
  hb: HbFont;
  /** A glyph with no outline (the space), or 0 when the font has none. */
  blankGlyph: number;
}

interface ScriptFace {
  file: string;
  script: RegExp;
}

/**
 * The bundled Noto Sans faces, each covering one script. A character takes the face of its
 * script; Latin, Greek and Cyrillic letters that the standard fonts cannot draw use Noto Sans.
 */
const SCRIPT_FACES: ScriptFace[] = [
  { file: 'NotoSansDevanagari-Regular', script: /\p{Script=Devanagari}/u },
  { file: 'NotoSansBengali-Regular', script: /\p{Script=Bengali}/u },
  { file: 'NotoSansGurmukhi-Regular', script: /\p{Script=Gurmukhi}/u },
  { file: 'NotoSansGujarati-Regular', script: /\p{Script=Gujarati}/u },
  { file: 'NotoSansOriya-Regular', script: /\p{Script=Oriya}/u },
  { file: 'NotoSansTamil-Regular', script: /\p{Script=Tamil}/u },
  { file: 'NotoSansTelugu-Regular', script: /\p{Script=Telugu}/u },
  { file: 'NotoSansKannada-Regular', script: /\p{Script=Kannada}/u },
  { file: 'NotoSansMalayalam-Regular', script: /\p{Script=Malayalam}/u },
  { file: 'NotoSansArabic-Regular', script: /\p{Script=Arabic}/u },
  { file: 'NotoSans-Regular', script: /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u },
];

/** Noto Sans also carries the general punctuation, currency and symbol characters. */
export const GENERAL_FACE = 'NotoSans-Regular';

const loaded = new Map<string, ShapingFont>();

/** Reads a font file; throws when it is not a TrueType or OpenType font. */
export function shapingFont(bytes: Uint8Array): ShapingFont {
  const font = fontkit.create(bytes);
  if (typeof font.hasGlyphForCodePoint !== 'function' || !font.unitsPerEm) {
    throw new TypeError('Not a single TrueType or OpenType font.');
  }
  return {
    name: (font.postscriptName ?? 'Font').replace(/[^\x21-\x7e]|[[\](){}<>/%#]/g, ''),
    bytes,
    font,
    hb: new HbFont(bytes),
    blankGlyph: font.hasGlyphForCodePoint(0x20) ? font.glyphForCodePoint(0x20).id : 0,
  };
}

function bundled(face: ScriptFace): ShapingFont {
  let font = loaded.get(face.file);
  if (!font) {
    const packed = packedFonts[face.file];
    if (!packed) {
      throw new Error(`The bundled font ${face.file} is missing from this build.`);
    }
    const bytes = new Uint8Array(brotliDecompressSync(Buffer.from(packed, 'base64')));
    font = shapingFont(bytes);
    loaded.set(face.file, font);
  }
  return font;
}

/** The bundled face for a character's script, without loading it. */
export function scriptFaceFor(char: string): string | undefined {
  return SCRIPT_FACES.find((entry) => entry.script.test(char))?.file;
}

/** A bundled face by its file name, read on first use and kept for the life of the process. */
export function bundledFont(file: string): ShapingFont {
  const face = SCRIPT_FACES.find((entry) => entry.file === file);
  if (!face) {
    throw new Error(`No bundled font is called ${file}.`);
  }
  return bundled(face);
}

/** The bundled face for Latin letters, punctuation and symbols the standard fonts lack. */
export const generalFont = (): ShapingFont => bundledFont(GENERAL_FACE);
