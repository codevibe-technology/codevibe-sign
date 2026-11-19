import type { PageSize, Rect } from '@codevibe/sign-core';

export type { PageSize };

/** A rectangle in CSS pixels, relative to the top-left corner of the rendered page. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** CSS pixels per PDF point when a page is shown `displayWidth` pixels wide. */
export function scaleForWidth(page: PageSize, displayWidth: number): number {
  if (page.width <= 0) return 1;
  return displayWidth / page.width;
}

export function pointsToPixels(rect: Rect, scale: number): PixelRect {
  return {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function pixelsToPoints(rect: PixelRect, scale: number): Rect {
  return {
    x: rect.left / scale,
    y: rect.top / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/**
 * Converts a pointer position to page points. `pageBox` is the page element's
 * bounding client rect; the result is not clamped to the page.
 */
export function clientToPoints(
  clientX: number,
  clientY: number,
  pageBox: { left: number; top: number },
  scale: number,
): { x: number; y: number } {
  return { x: (clientX - pageBox.left) / scale, y: (clientY - pageBox.top) / scale };
}

/**
 * Converts a top-left-origin rect (the core convention) to the bottom-left origin
 * PDF content streams use. Applying it twice returns the original rect.
 */
export function flipVertical(rect: Rect, page: PageSize): Rect {
  return { ...rect, y: page.height - rect.y - rect.height };
}

/** Rounds to 1/100 of a point so emitted fields stay readable and stable. */
export function roundRect(rect: Rect): Rect {
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(rect.x), y: r(rect.y), width: r(rect.width), height: r(rect.height) };
}

/** Keeps the rect inside the page, shrinking it only when it is larger than the page. */
export function clampRect(rect: Rect, page: PageSize, minSize = 1): Rect {
  const width = Math.min(Math.max(rect.width, minSize), page.width);
  const height = Math.min(Math.max(rect.height, minSize), page.height);
  const x = Math.min(Math.max(rect.x, 0), page.width - width);
  const y = Math.min(Math.max(rect.y, 0), page.height - height);
  return { x, y, width, height };
}

/** Moves a rect flush with any page edge it is within `threshold` points of, then clamps it. */
export function snapToPageEdges(rect: Rect, page: PageSize, threshold: number): Rect {
  let { x, y } = rect;
  if (Math.abs(x) <= threshold) x = 0;
  else if (Math.abs(page.width - (x + rect.width)) <= threshold) x = page.width - rect.width;
  if (Math.abs(y) <= threshold) y = 0;
  else if (Math.abs(page.height - (y + rect.height)) <= threshold) y = page.height - rect.height;
  return clampRect({ ...rect, x, y }, page);
}

/** Resizes from the bottom-right corner, snapping that corner to the page edges. */
export function resizeRect(
  rect: Rect,
  width: number,
  height: number,
  page: PageSize,
  minSize: number,
  threshold = 0,
): Rect {
  let w = Math.max(minSize, Math.min(width, page.width - rect.x));
  let h = Math.max(minSize, Math.min(height, page.height - rect.y));
  if (page.width - (rect.x + w) <= threshold) w = page.width - rect.x;
  if (page.height - (rect.y + h) <= threshold) h = page.height - rect.y;
  return clampRect({ ...rect, width: w, height: h }, page, minSize);
}
