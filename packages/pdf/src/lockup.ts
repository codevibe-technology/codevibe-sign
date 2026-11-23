import {
  LineCapStyle,
  LineJoinStyle,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { LOCKUP } from './lockup-paths';

function hex(color: string): RGB {
  const value = Number.parseInt(color.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** Width in points of the lockup drawn `height` points tall. */
export function lockupWidth(height: number): number {
  return (LOCKUP.width * height) / LOCKUP.height;
}

/**
 * Draws the Codevibe Sign lockup (mark and wordmark) as vector paths, so it needs no font.
 * (`x`, `top`) is its top-left corner and `height` its height in points, descender included.
 */
export function drawLockup(page: PDFPage, box: { x: number; top: number; height: number }): void {
  const unit = box.height / LOCKUP.height;
  const mark = unit * LOCKUP.markScale;
  for (const stroke of LOCKUP.strokes) {
    if (stroke.round) page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
    page.drawSvgPath(stroke.d, {
      x: box.x,
      y: box.top,
      scale: mark,
      borderColor: hex(stroke.color),
      borderWidth: stroke.width,
      borderLineCap: stroke.round ? LineCapStyle.Round : LineCapStyle.Butt,
    });
    if (stroke.round) page.pushOperators(popGraphicsState());
  }
  for (const fill of LOCKUP.fills) {
    page.drawSvgPath(fill.d, { x: box.x, y: box.top, scale: unit, color: hex(fill.color) });
  }
}
