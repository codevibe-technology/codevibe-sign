import fontkit from '@pdf-lib/fontkit';
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';
import { SignError } from '@codevibe_technology/sign-core';

export interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  /** True when a caller-supplied font is used for regular and bold text. */
  custom: boolean;
}

/**
 * Standard Helvetica and Courier cover Latin script only (WinAnsi). A custom
 * TrueType or OpenType font replaces the regular and bold faces so names in other
 * scripts can be drawn; hashes stay in Courier, which only ever holds hex.
 */
export async function embedFonts(doc: PDFDocument, customFont?: Uint8Array): Promise<FontSet> {
  const mono = await doc.embedFont(StandardFonts.Courier);
  if (customFont) {
    // fontkit's shapers for complex scripts (Devanagari and others) expect this global.
    await import('regenerator-runtime/runtime.js');
    doc.registerFontkit(fontkit);
    let font: PDFFont;
    try {
      font = await doc.embedFont(customFont, { subset: false });
    } catch {
      throw new SignError(
        'VALIDATION',
        'The custom font could not be read. Use a TTF or OTF file.',
        {
          field: 'font',
        },
      );
    }
    return { regular: font, bold: font, mono, custom: true };
  }
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { regular, bold, mono, custom: false };
}

/** Whether every character of the text can be drawn with the font. */
export function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    font.widthOfTextAtSize(text, 10);
    return true;
  } catch {
    return false;
  }
}

/** Replaces characters the font cannot draw with '?', one character at a time. */
export function encodable(font: PDFFont, text: string): string {
  if (canEncode(font, text)) {
    return text;
  }
  return Array.from(text)
    .map((char) => (canEncode(font, char) ? char : '?'))
    .join('');
}
