import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { fitText, LINE_HEIGHT, wrapText } from './text';

let font: PDFFont;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
});

describe('wrapText', () => {
  it('breaks at spaces', () => {
    const lines = wrapText('one two three four five six', font, 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five six');
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(60);
    }
  });

  it('breaks words longer than a line', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const lines = wrapText(hash, font, 10, 100);
    expect(lines.join('')).toBe(hash);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(100);
    }
  });

  it('keeps explicit line breaks', () => {
    expect(wrapText('first\nsecond', font, 10, 500)).toEqual(['first', 'second']);
  });
});

describe('fitText', () => {
  it('uses the largest size that fits on one line', () => {
    const fitted = fitText('Shubh Kumar', font, 200, 30);
    expect(fitted.lines).toEqual(['Shubh Kumar']);
    expect(fitted.size).toBe(14);
    expect(fitted.truncated).toBe(false);
  });

  it('shrinks text to fit a narrow box', () => {
    const fitted = fitText('Shubh Kumar Sharma', font, 80, 16);
    expect(fitted.lines).toHaveLength(1);
    expect(fitted.size).toBeLessThan(12);
    expect(font.widthOfTextAtSize(fitted.lines[0] ?? '', fitted.size)).toBeLessThanOrEqual(76);
  });

  it('wraps long text in a tall box', () => {
    const text =
      'I agree to the terms of employment described in this letter, including notice period.';
    const fitted = fitText(text, font, 150, 80);
    expect(fitted.lines.length).toBeGreaterThan(1);
    expect(fitted.lines.length * fitted.size * LINE_HEIGHT).toBeLessThanOrEqual(80);
    expect(fitted.truncated).toBe(false);
  });

  it('cuts text that cannot fit with an ellipsis', () => {
    const text = 'word '.repeat(200);
    const fitted = fitText(text, font, 100, 20);
    expect(fitted.truncated).toBe(true);
    expect(fitted.size).toBe(6);
    expect(fitted.lines.at(-1)?.endsWith('...')).toBe(true);
    expect(fitted.lines.length * fitted.size * LINE_HEIGHT).toBeLessThanOrEqual(20);
  });
});
