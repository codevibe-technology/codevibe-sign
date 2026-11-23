import {
  beginText,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFObject,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type Color,
  type PDFDocument,
  PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { EmbeddedFont } from './cid-font';
import { placeGlyphs, type PlacedGlyph } from './copy-text';
import {
  bundledFont,
  GENERAL_FACE,
  generalFont,
  scriptFaceFor,
  type ShapingFont,
} from './script-fonts';

/** What text layout needs from a font: the same two measurements pdf-lib's fonts offer. */
export interface Measure {
  widthOfTextAtSize(text: string, size: number): number;
  heightAtSize(size: number, options?: { descender?: boolean }): number;
}

export interface DrawTextOptions {
  x: number;
  y: number;
  size: number;
  color: Color;
  /** Counter-clockwise rotation of the baseline around (x, y), in degrees. */
  rotate?: number;
}

type Run =
  | { kind: 'pdf'; font: PDFFont; text: string; width: number }
  | {
      kind: 'shaped';
      font: ShapingFont;
      text: string;
      rtl: boolean;
      glyphs: PlacedGlyph[];
      width: number;
    };

/** Where a character is drawn from. */
type Slot = PDFFont | ShapingFont;

const drawnByPdfLib = (slot: Slot): slot is PDFFont => slot instanceof PDFFont;

const MARK = /\p{M}|\u200c|\u200d|[\ufe00-\ufe0f]/u;
const SPACE = /\s/u;
const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;
const STRONG = /[\p{L}\p{Nd}]/u;
const FAUX_BOLD_STROKE = 0.035;

/**
 * The shaping fonts one document uses, embedded once each when the document is finished.
 */
export class Typesetter {
  private readonly embedded = new Map<ShapingFont, EmbeddedFont>();

  constructor(readonly doc: PDFDocument) {}

  embed(font: ShapingFont): EmbeddedFont {
    let embedded = this.embedded.get(font);
    if (!embedded) {
      embedded = new EmbeddedFont(this.doc, font);
      this.embedded.set(font, embedded);
    }
    return embedded;
  }

  /** Writes the fonts used so far. Call before saving the document. */
  async finish(): Promise<void> {
    for (const font of this.embedded.values()) {
      await font.finish();
    }
    this.embedded.clear();
  }
}

export interface FaceOptions {
  /** Draw shaped runs heavier, for a bold face without a bold font file. */
  bold?: boolean;
  /** Tried before the standard font for every character it covers. */
  custom?: ShapingFont;
  /**
   * A caller's CFF-based OpenType font, tried first like `custom`. It is embedded and laid out
   * by pdf-lib, without HarfBuzz shaping; suits scripts that need none, such as CJK.
   */
  customCff?: { font: PDFFont; has(codePoint: number): boolean };
  /** Fall back to the bundled script fonts. When false, uncovered characters become `?`. */
  fallback?: boolean;
}

/**
 * Text in one style that can hold any script: a standard PDF font for what it can encode, the
 * caller's font when given, and the bundled Noto faces for everything else. Each run of text in
 * another script is shaped with HarfBuzz (conjuncts, vowel signs, Arabic joining) and Arabic
 * runs are placed right to left. Characters no font covers are drawn as `?`.
 */
export class Face implements Measure {
  private readonly layouts = new Map<string, Run[]>();
  private readonly encodable = new Map<string, boolean>();

  constructor(
    private readonly typesetter: Typesetter,
    readonly primary: PDFFont,
    private readonly options: FaceOptions = {},
  ) {}

  widthOfTextAtSize(text: string, size: number): number {
    return this.layout(text).reduce((sum, run) => sum + run.width, 0) * size;
  }

  heightAtSize(size: number, options?: { descender?: boolean }): number {
    return this.primary.heightAtSize(size, options);
  }

  /** Whether every character is drawn as itself, not as `?`. */
  covers(text: string): boolean {
    return Array.from(text.normalize('NFC')).every((char) => this.slotOf(char) !== undefined);
  }

  draw(page: PDFPage, text: string, options: DrawTextOptions): void {
    const angle = ((options.rotate ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let pen = 0;
    for (const run of this.layout(text)) {
      const x = options.x + cos * pen * options.size;
      const y = options.y + sin * pen * options.size;
      if (run.kind === 'pdf') {
        page.drawText(run.text, {
          x,
          y,
          size: options.size,
          font: run.font,
          color: options.color,
          rotate: degrees(options.rotate ?? 0),
        });
      } else {
        this.drawShaped(page, run, { ...options, x, y }, cos, sin);
      }
      pen += run.width;
    }
  }

  private drawShaped(
    page: PDFPage,
    run: Extract<Run, { kind: 'shaped' }>,
    options: DrawTextOptions,
    cos: number,
    sin: number,
  ): void {
    const font = this.typesetter.embed(run.font);
    const scale = options.size / run.font.font.unitsPerEm;
    const operators = [pushGraphicsState(), setFillingColor(options.color)];
    if (this.options.bold) {
      operators.push(
        setStrokingColor(options.color),
        setLineWidth(options.size * FAUX_BOLD_STROKE),
        setTextRenderingMode(TextRenderingMode.FillAndOutline),
      );
    }
    // Readers that honour /ActualText copy a left-to-right run as typed, whatever the glyph
    // order. Right-to-left runs are left to the reader's own reordering of the glyph text.
    if (!run.rtl) {
      const properties = `<< /ActualText ${PDFHexString.fromText(run.text).toString()} >>`;
      operators.push(
        PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
          PDFName.of('Span'),
          properties,
        ]),
      );
    }
    operators.push(beginText(), setFontAndSize(font.resourceOn(page), options.size));
    // Glyphs on the baseline go out as one string, so readers see one word; marks placed off it
    // (vowel signs above or below, nuktas) follow, each at its own position.
    const line: PDFObject[] = [];
    const marks: PDFOperator[] = [];
    let pen = 0;
    let skipped = 0;
    for (const glyph of run.glyphs) {
      const code = font.code(glyph.id, glyph.text, glyph.advance);
      if (glyph.xOffset === 0 && glyph.yOffset === 0) {
        if (skipped !== 0) {
          line.push(PDFNumber.of(-skipped * (1000 / run.font.font.unitsPerEm)));
          skipped = 0;
        }
        line.push(code);
      } else {
        const dx = pen + glyph.xOffset * scale;
        const dy = glyph.yOffset * scale;
        marks.push(
          setTextMatrix(
            cos,
            sin,
            -sin,
            cos,
            options.x + cos * dx - sin * dy,
            options.y + sin * dx + cos * dy,
          ),
          showText(code),
        );
        skipped += glyph.advance;
      }
      pen += glyph.advance * scale;
    }
    operators.push(
      setTextMatrix(cos, sin, -sin, cos, options.x, options.y),
      PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [this.typesetter.doc.context.obj(line)]),
      ...marks,
    );
    operators.push(endText());
    if (!run.rtl) {
      operators.push(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    }
    operators.push(popGraphicsState());
    page.pushOperators(...operators);
  }

  private canEncode(char: string): boolean {
    let result = this.encodable.get(char);
    if (result === undefined) {
      try {
        this.primary.encodeText(char);
        this.primary.widthOfTextAtSize(char, 10);
        result = true;
      } catch {
        result = false;
      }
      this.encodable.set(char, result);
    }
    return result;
  }

  /** The preferred source for a character on its own, or undefined when none covers it. */
  private slotOf(char: string): Slot | undefined {
    const code = char.codePointAt(0)!;
    const { custom, customCff } = this.options;
    if (custom?.font.hasGlyphForCodePoint(code)) {
      return custom;
    }
    if (customCff?.has(code)) {
      return customCff.font;
    }
    const fallback = this.options.fallback !== false;
    const script = fallback ? scriptFaceFor(char) : undefined;
    if ((!script || script === GENERAL_FACE) && this.canEncode(char)) {
      return this.primary;
    }
    if (!fallback) {
      return undefined;
    }
    if (script) {
      const font = bundledFont(script);
      if (font.font.hasGlyphForCodePoint(code)) {
        return font;
      }
    }
    const general = generalFont();
    return general.font.hasGlyphForCodePoint(code) ? general : undefined;
  }

  private layout(text: string): Run[] {
    let runs = this.layouts.get(text);
    if (!runs) {
      runs = this.buildLayout(text);
      this.layouts.set(text, runs);
    }
    return runs;
  }

  private buildLayout(text: string): Run[] {
    const chars = Array.from(text.normalize('NFC'));
    const slots: Slot[] = [];
    const shown: string[] = [];
    chars.forEach((char, index) => {
      const previous = slots[index - 1];
      const code = char.codePointAt(0)!;
      // Marks and joiners belong to the letter before them, in that letter's font when it can.
      if (previous !== undefined && MARK.test(char)) {
        if (previous === this.primary && !this.canEncode(char)) {
          const general = this.options.fallback === false ? undefined : generalFont();
          if (general?.font.hasGlyphForCodePoint(code) && shown[index - 1] !== '?') {
            slots[index - 1] = general;
            slots.push(general);
            shown.push(char);
          } else {
            slots.push(this.primary);
            shown.push('');
          }
          return;
        }
        slots.push(previous);
        shown.push(char);
        return;
      }
      // Spaces and punctuation stay in the run they sit in when its font has them.
      if (
        previous !== undefined &&
        !drawnByPdfLib(previous) &&
        !STRONG.test(char) &&
        previous.font.hasGlyphForCodePoint(code)
      ) {
        slots.push(previous);
        shown.push(char);
        return;
      }
      const own = this.slotOf(char);
      slots.push(own ?? this.primary);
      shown.push(own ? char : '?');
    });
    this.keepWordsWhole(chars, slots);

    const rtl = this.directions(chars);
    const pieces: { slot: Slot; rtl: boolean; text: string }[] = [];
    shown.forEach((char, index) => {
      const slot = slots[index]!;
      const last = pieces[pieces.length - 1];
      if (last && last.slot === slot && last.rtl === rtl[index]) {
        last.text += char;
      } else {
        pieces.push({ slot, rtl: rtl[index]!, text: char });
      }
    });

    const runs: Run[] = [];
    let group: Run[] = [];
    for (const piece of pieces) {
      const run = this.shapeRun(piece.slot, piece.text, piece.rtl);
      if (piece.rtl) {
        group.unshift(run);
      } else {
        runs.push(...group, run);
        group = [];
      }
    }
    runs.push(...group);
    return runs;
  }

  /**
   * A Latin word with one letter the standard font lacks (`Łukasz`) is drawn wholly in Noto
   * Sans instead of switching fonts mid-word.
   */
  private keepWordsWhole(chars: string[], slots: Slot[]): void {
    if (this.options.fallback === false) {
      return;
    }
    const general = generalFont();
    let start = 0;
    for (let index = 0; index <= chars.length; index += 1) {
      if (index < chars.length && !SPACE.test(chars[index]!)) {
        continue;
      }
      const word = slots.slice(start, index);
      if (
        word.includes(general) &&
        word.every((slot) => slot === this.primary || slot === general)
      ) {
        for (let at = start; at < index; at += 1) {
          if (general.font.hasGlyphForCodePoint(chars[at]!.codePointAt(0)!)) {
            slots[at] = general;
          }
        }
      }
      start = index + 1;
    }
  }

  /**
   * Which characters read right to left, in a left-to-right line: Arabic-script letters, and
   * the spaces and punctuation between two of them.
   */
  private directions(chars: string[]): boolean[] {
    const strong = chars.map((char) =>
      RTL.test(char) ? 'r' : STRONG.test(char) ? 'l' : undefined,
    );
    return chars.map((char, index) => {
      if (strong[index]) {
        return strong[index] === 'r';
      }
      let before: string | undefined;
      for (let at = index - 1; at >= 0 && !before; at -= 1) before = strong[at];
      let after: string | undefined;
      for (let at = index + 1; at < chars.length && !after; at += 1) after = strong[at];
      if (MARK.test(char)) {
        return before === 'r';
      }
      return before === 'r' && after === 'r';
    });
  }

  private shapeRun(slot: Slot, text: string, rtl: boolean): Run {
    if (drawnByPdfLib(slot)) {
      return { kind: 'pdf', font: slot, text, width: slot.widthOfTextAtSize(text, 1) };
    }
    const shaped = slot.hb.shape(text, rtl ? 'rtl' : 'ltr');
    const glyphs = placeGlyphs(text, shaped, rtl, slot.blankGlyph);
    const width = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0) / slot.font.unitsPerEm;
    return { kind: 'shaped', font: slot, text, rtl, glyphs, width };
  }
}
