import qrcode from 'qrcode-generator';
import {
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingColor,
  type PDFPage,
} from 'pdf-lib';
import { SignError } from '@codevibe_technology/sign-core';

/** Light modules a reader needs around the code to find it. */
const QUIET_ZONE = 4;

/**
 * The QR code for a link, as rows of modules (true is dark), without the quiet zone.
 * Error correction level M: a quarter of the code may be smudged in print and it still reads.
 */
export function qrModules(url: string): boolean[][] {
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    throw new SignError('VALIDATION', 'The record link must be an absolute URL.', {
      field: 'recordUrl',
    });
  }
  const code = qrcode(0, 'M');
  code.addData(href, 'Byte');
  code.make();
  const count = code.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, column) => code.isDark(row, column)),
  );
}

/**
 * Draws the code as black rectangles in a white square of `size` points whose top-left
 * corner is at (`x`, `top`). Each run of dark modules in a row is one rectangle.
 */
export function drawQr(
  page: PDFPage,
  modules: boolean[][],
  box: { x: number; top: number; size: number },
): void {
  const count = modules.length;
  const module = box.size / (count + QUIET_ZONE * 2);
  const operators = [
    pushGraphicsState(),
    setFillingColor(rgb(1, 1, 1)),
    rectangle(box.x, box.top - box.size, box.size, box.size),
    fill(),
    setFillingColor(rgb(0, 0, 0)),
  ];
  modules.forEach((row, rowIndex) => {
    const y = box.top - (QUIET_ZONE + rowIndex + 1) * module;
    let start = -1;
    for (let column = 0; column <= count; column += 1) {
      const dark = column < count && row[column] === true;
      if (dark && start < 0) {
        start = column;
      } else if (!dark && start >= 0) {
        operators.push(
          rectangle(box.x + (QUIET_ZONE + start) * module, y, (column - start) * module, module),
        );
        start = -1;
      }
    }
  });
  operators.push(fill(), popGraphicsState());
  page.pushOperators(...operators);
}
