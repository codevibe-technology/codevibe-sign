import { PDFDocument, PDFName, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { embedFonts, type FontSet } from './fonts';
import { extractText, SAMPLE_NAMES } from './testing/extract';

async function draw(
  lines: string[],
  use: (fonts: FontSet) => FontSet['regular'] = (f) => f.regular,
) {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const page = doc.addPage([595, 842]);
  lines.forEach((line, index) => {
    use(fonts).draw(page, line, { x: 40, y: 800 - index * 30, size: 14, color: rgb(0, 0, 0) });
  });
  await fonts.finish();
  return doc.save();
}

const fontNames = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const names: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object as { get?: (key: PDFName) => unknown };
    if (typeof dict.get === 'function' && String(dict.get(PDFName.of('Type'))) === '/Font') {
      names.push(String(dict.get(PDFName.of('BaseFont'))));
    }
  }
  return names;
};

describe('Face', () => {
  it('draws every sample name so that a reader extracts it as typed', async () => {
    const text = await extractText(await draw(SAMPLE_NAMES));
    expect(text.join('\n')).not.toContain('?');
    for (const name of SAMPLE_NAMES) {
      expect(text.join(' ')).toContain(name.split(' ')[0]);
      for (const word of name.split(' ')) {
        expect(text.some((item) => item.includes(word))).toBe(true);
      }
    }
  });

  it('covers every sample name and every Devanagari conjunct', async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    for (const name of [...SAMPLE_NAMES, 'क्ष', 'त्र', 'श्री', 'ज्ञ']) {
      expect(fonts.regular.covers(name)).toBe(true);
    }
    expect(fonts.regular.covers('😀')).toBe(false);
  });

  it('keeps Latin text in Helvetica and embeds no extra font for it', async () => {
    const names = await fontNames(await draw(['Asha Rao', 'Zoë Ñúñez']));
    expect(names.sort()).toEqual(['/Courier', '/Helvetica', '/Helvetica-Bold']);
  });

  it('embeds a subset of the script font only for the scripts used', async () => {
    const names = await fontNames(await draw(['आशा Rao']));
    expect(names).toContain('/Helvetica');
    expect(names.filter((name) => name.includes('NotoSansDevanagari'))).toHaveLength(2);
    expect(names.some((name) => name.includes('Tamil'))).toBe(false);
  });

  it('draws a Latin word with a letter outside WinAnsi wholly in Noto Sans', async () => {
    const bytes = await draw(['Łukasz']);
    expect((await fontNames(bytes)).some((name) => name.endsWith('+NotoSans-Regular'))).toBe(true);
    expect(await extractText(bytes)).toEqual(['Łukasz']);
  });

  it('measures shaped text from the shaped advances', async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    const conjunct = fonts.regular.widthOfTextAtSize('क्ष', 10);
    // क्ष is one 717-unit glyph in a 1000-unit font: narrower than क plus ष.
    expect(conjunct).toBeCloseTo(7.17, 2);
    expect(fonts.regular.widthOfTextAtSize('कष', 10)).toBeGreaterThan(conjunct);
  });

  it('places a right-to-left run after the Latin text before it', async () => {
    const text = await extractText(await draw(['Acme علی']));
    expect(text.join(' ')).toMatch(/Acme/);
    expect(text.join(' ')).toMatch(/علی/);
  });

  it('draws characters no font covers as a question mark instead of failing', async () => {
    const text = await extractText(await draw(['Asha 😀']));
    expect(text.join(' ')).toContain('Asha ?');
  });

  it('keeps mono text to the standard font', async () => {
    const text = await extractText(await draw(['abc आ'], (fonts) => fonts.mono));
    expect(text.join(' ')).toContain('abc ?');
  });

  it('draws bold script text heavier with the same glyphs', async () => {
    const bytes = await draw(['आशा राव'], (fonts) => fonts.bold);
    expect((await extractText(bytes)).join(' ')).toContain('आशा राव');
  });
});
