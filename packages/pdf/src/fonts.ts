import fontkit from '@pdf-lib/fontkit';
import { StandardFonts, type PDFDocument } from 'pdf-lib';
import { SignError } from '@codevibe_technology/sign-core';
import { shapingFont } from './script-fonts';
import { Face, Typesetter, type FaceOptions } from './typeset';

export interface FontSet {
  regular: Face;
  bold: Face;
  /** Courier, for hashes and ids; it only ever holds ASCII. */
  mono: Face;
  /** True when a caller-supplied font is tried first for regular and bold text. */
  custom: boolean;
  /** Embeds the script fonts the text used. Call before saving the document. */
  finish(): Promise<void>;
}

const unreadable = () =>
  new SignError('VALIDATION', 'The custom font could not be read. Use a TTF or OTF file.', {
    field: 'font',
  });

/**
 * A TrueType font is shaped with HarfBuzz like the bundled ones. A CFF-based OpenType font
 * cannot be embedded that way and goes through pdf-lib instead.
 */
async function customFont(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<Pick<FaceOptions, 'custom' | 'customCff'>> {
  let parsed: ReturnType<typeof fontkit.create>;
  try {
    parsed = fontkit.create(bytes);
  } catch {
    throw unreadable();
  }
  const tables = (parsed as unknown as { directory?: { tables?: Record<string, unknown> } })
    .directory?.tables;
  if (!tables?.['CFF '] && !tables?.CFF2) {
    try {
      return { custom: shapingFont(bytes) };
    } catch {
      throw unreadable();
    }
  }
  // fontkit's layout code for complex scripts expects this global.
  await import('regenerator-runtime/runtime.js');
  doc.registerFontkit(fontkit);
  try {
    const font = await doc.embedFont(bytes, { subset: false });
    return { customCff: { font, has: (code) => parsed.hasGlyphForCodePoint(code) } };
  } catch {
    throw unreadable();
  }
}

/**
 * Helvetica draws what WinAnsi can encode; names and titles in other scripts (Indian scripts,
 * Arabic, Greek, Cyrillic, accented Latin beyond WinAnsi) use the bundled Noto fonts, shaped
 * and subset into the file. A custom TrueType or OpenType font, when given, is tried first for
 * every character it covers.
 */
export async function embedFonts(doc: PDFDocument, customFontBytes?: Uint8Array): Promise<FontSet> {
  const custom = customFontBytes ? await customFont(doc, customFontBytes) : {};
  const typesetter = new Typesetter(doc);
  const [regular, bold, mono] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Courier),
  ]);
  return {
    regular: new Face(typesetter, regular, custom),
    bold: new Face(typesetter, bold, { ...custom, bold: true }),
    mono: new Face(typesetter, mono, { fallback: false }),
    custom: customFontBytes !== undefined,
    finish: () => typesetter.finish(),
  };
}
