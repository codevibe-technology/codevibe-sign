import type { PDFFont } from 'pdf-lib';

/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const char of Array.from(word)) {
    const candidate = current + char;
    if (current !== '' && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current !== '') {
    pieces.push(current);
  }
  return pieces;
}

/**
 * Wraps text to a width: breaks at spaces, and inside words that are wider than
 * a whole line (hashes, user agents, long e-mail addresses). Keeps explicit newlines.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter((word) => word !== '');
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== '') {
        lines.push(line);
      }
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word;
      } else {
        const pieces = splitLongWord(word, font, size, maxWidth);
        line = pieces.pop() ?? '';
        lines.push(...pieces);
      }
    }
    lines.push(line);
  }
  return lines;
}

function ellipsize(line: string, font: PDFFont, size: number, maxWidth: number): string {
  const ellipsis = '...';
  let chars = Array.from(line);
  while (chars.length > 0 && font.widthOfTextAtSize(chars.join('') + ellipsis, size) > maxWidth) {
    chars = chars.slice(0, -1);
  }
  return chars.join('').trimEnd() + ellipsis;
}

export interface FittedText {
  size: number;
  lines: string[];
  /** True when the text did not fit even at the smallest size and was cut short. */
  truncated: boolean;
}

export interface FitTextOptions {
  minSize?: number;
  maxSize?: number;
}

/**
 * Picks the largest font size (in half-point steps) at which the wrapped text fits
 * the box. Single-line boxes get one line; taller boxes may wrap. If nothing fits at
 * the minimum size the text is cut with an ellipsis rather than overflowing the box.
 */
export function fitText(
  text: string,
  font: PDFFont,
  boxWidth: number,
  boxHeight: number,
  options: FitTextOptions = {},
): FittedText {
  const minSize = options.minSize ?? 6;
  const maxSize = Math.max(minSize, Math.min(options.maxSize ?? 14, boxHeight / LINE_HEIGHT));
  const padding = 2;
  const width = Math.max(1, boxWidth - padding * 2);

  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const lines = wrapText(text, font, size, width);
    if (lines.length * size * LINE_HEIGHT <= boxHeight) {
      return { size, lines, truncated: false };
    }
  }

  const size = minSize;
  const all = wrapText(text, font, size, width);
  const room = Math.max(1, Math.floor(boxHeight / (size * LINE_HEIGHT)));
  const lines = all.slice(0, room);
  const last = lines.length - 1;
  lines[last] = ellipsize(lines[last] ?? '', font, size, width);
  return { size, lines, truncated: true };
}
