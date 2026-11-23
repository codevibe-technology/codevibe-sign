import { createHash } from 'node:crypto';
import {
  PDFHexString,
  PDFName,
  PDFString,
  type PDFDocument,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import { subsetFont } from './harfbuzz';
import type { ShapingFont } from './script-fonts';

interface Entry {
  glyph: number;
  /** The characters this glyph stands for when text is copied. */
  text: string;
  /** Advance as placed by the shaper, in font units; marks over a letter advance by 0. */
  advance: number;
}

function utf16Hex(text: string): string {
  let hex = '';
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return hex;
}

const SPACE_CODE = 0x20;

const cidHex = (cid: number) => cid.toString(16).padStart(4, '0');

function toUnicodeCMap(entries: Entry[]): string {
  const mapped = entries
    .map((entry, index) => ({ cid: index + 1, text: entry.text }))
    .filter((entry) => entry.text !== '');
  const blocks: string[] = [];
  for (let start = 0; start < mapped.length; start += 100) {
    const chunk = mapped.slice(start, start + 100);
    blocks.push(
      `${chunk.length} beginbfchar`,
      ...chunk.map((entry) => `<${cidHex(entry.cid)}> <${utf16Hex(entry.text)}>`),
      'endbfchar',
    );
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/**
 * One shaping font as used by one document: a Type 0 font with Identity-H encoding whose codes
 * are allocated per glyph and copied text. Giving the same glyph a second code when it stands
 * for different text keeps copy and search right for reordered vowel signs and conjuncts.
 * Only the glyphs that were drawn are embedded.
 */
export class EmbeddedFont {
  readonly ref: PDFRef;
  private readonly entries: Entry[] = [];
  private readonly codes = new Map<string, number>();
  private readonly keys = new WeakMap<PDFPage, PDFName>();

  constructor(
    private readonly doc: PDFDocument,
    readonly source: ShapingFont,
  ) {
    this.ref = doc.context.nextRef();
  }

  /**
   * The two-byte code that draws `glyph`, copies as `text` and declares `advance` as its width,
   * so readers that rebuild words from glyph positions find no gaps inside them.
   */
  code(glyph: number, text: string, advance: number): PDFHexString {
    const key = `${glyph}:${advance}:${text}`;
    let cid = this.codes.get(key);
    if (cid === undefined) {
      // Some readers take code 32 for a word space whatever the font; leave it unused.
      if (this.entries.length + 1 === SPACE_CODE) {
        this.entries.push({ glyph: 0, text: '', advance: 0 });
      }
      this.entries.push({ glyph, text, advance });
      cid = this.entries.length;
      if (cid > 0xffff) {
        throw new RangeError('Too many distinct glyphs for one embedded font.');
      }
      this.codes.set(key, cid);
    }
    return PDFHexString.of(cidHex(cid));
  }

  /** The font's name in the page's resources, added on first use. */
  resourceOn(page: PDFPage): PDFName {
    let key = this.keys.get(page);
    if (!key) {
      key = page.node.newFontDictionary('CvsScript', this.ref);
      this.keys.set(page, key);
    }
    return key;
  }

  /** Writes the font objects. Call once, after the last text is drawn and before saving. */
  async finish(): Promise<void> {
    const { context } = this.doc;
    const { font } = this.source;
    const scale = 1000 / font.unitsPerEm;
    const glyphMap = new Uint8Array((this.entries.length + 1) * 2);
    const widths: number[] = [];
    this.entries.forEach((entry, index) => {
      glyphMap[(index + 1) * 2] = entry.glyph >> 8;
      glyphMap[(index + 1) * 2 + 1] = entry.glyph & 0xff;
      widths.push(Math.round(entry.advance * scale * 100) / 100);
    });
    const fontFile = subsetFont(
      this.source.bytes,
      this.entries.map((entry) => entry.glyph),
    );

    const tag = createHash('sha256')
      .update(this.source.name)
      .update(JSON.stringify(this.entries))
      .digest()
      .subarray(0, 6)
      .reduce((name, byte) => name + String.fromCharCode(65 + (byte % 26)), '');
    const baseFont = PDFName.of(`${tag}+${this.source.name}`);
    const { bbox } = font;

    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: baseFont,
        Flags: 4,
        FontBBox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((value) =>
          Math.round(value * scale),
        ),
        ItalicAngle: 0,
        Ascent: Math.round(font.ascent * scale),
        Descent: Math.round(font.descent * scale),
        CapHeight: Math.round((font.capHeight || font.ascent) * scale),
        StemV: 80,
        FontFile2: context.register(context.flateStream(fontFile, { Length1: fontFile.length })),
      }),
    );
    const descendant = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: baseFont,
        CIDSystemInfo: {
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0,
        },
        FontDescriptor: descriptor,
        DW: 0,
        W: [1, widths],
        CIDToGIDMap: context.register(context.flateStream(glyphMap)),
      }),
    );
    context.assign(
      this.ref,
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: baseFont,
        Encoding: 'Identity-H',
        DescendantFonts: [descendant],
        ToUnicode: context.register(context.flateStream(toUnicodeCMap(this.entries))),
      }),
    );
  }
}
