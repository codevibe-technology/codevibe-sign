import type { Field, Rect } from '@codevibe_technology/sign-core';
import { clampRect, roundRect, type PageSize } from '../geometry';

/** A line a dragged field lined up with: `x` is a vertical line, `y` a horizontal one. */
export interface Guide {
  axis: 'x' | 'y';
  /** Position on the page in points. */
  at: number;
}

const edges = (start: number, size: number) => [start, start + size / 2, start + size];

/**
 * Lines a moving rect up with the fields around it: its left, centre or right with theirs,
 * and its top, middle or bottom with theirs, whichever is nearest within `threshold` points.
 * Page edges and the page centre count as neighbours too. Returns the moved rect and the
 * lines it snapped to, so they can be drawn while dragging.
 */
export function alignRect(
  rect: Rect,
  others: Rect[],
  page: PageSize,
  threshold: number,
): { rect: Rect; guides: Guide[] } {
  const xs = [0, page.width / 2, page.width, ...others.flatMap((o) => edges(o.x, o.width))];
  const ys = [0, page.height / 2, page.height, ...others.flatMap((o) => edges(o.y, o.height))];

  const best = (start: number, size: number, lines: number[]) => {
    let found: { shift: number; at: number } | null = null;
    for (const own of edges(start, size)) {
      for (const at of lines) {
        const shift = at - own;
        if (Math.abs(shift) <= threshold && (!found || Math.abs(shift) < Math.abs(found.shift))) {
          found = { shift, at };
        }
      }
    }
    return found;
  };

  const bx = best(rect.x, rect.width, xs);
  const by = best(rect.y, rect.height, ys);
  const moved = clampRect(
    { ...rect, x: rect.x + (bx?.shift ?? 0), y: rect.y + (by?.shift ?? 0) },
    page,
  );
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: 'x', at: bx.at });
  if (by) guides.push({ axis: 'y', at: by.at });
  return { rect: roundRect(moved), guides };
}

/** Which corner of a field is being dragged to resize it. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * The rect after dragging one corner by `dx`, `dy` points: the opposite corner stays put,
 * the size never drops under `minSize`, and the rect stays on the page.
 */
export function resizeFromCorner(
  rect: Rect,
  corner: Corner,
  dx: number,
  dy: number,
  page: PageSize,
  minSize: number,
): Rect {
  let { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;
  if (corner === 'nw' || corner === 'sw') {
    const left = Math.min(Math.max(0, x + dx), right - minSize);
    x = left;
    width = right - left;
  } else {
    width = Math.max(minSize, Math.min(width + dx, page.width - x));
  }
  if (corner === 'nw' || corner === 'ne') {
    const top = Math.min(Math.max(0, y + dy), bottom - minSize);
    y = top;
    height = bottom - top;
  } else {
    height = Math.max(minSize, Math.min(height + dy, page.height - y));
  }
  return roundRect(clampRect({ x, y, width, height }, page, minSize));
}

/**
 * Copies of `fields` for pasting: new ids, nudged `offset` points down and right (kept on the
 * page), on the same page and document as the originals.
 */
export function pasteCopies(
  fields: Field[],
  pageSize: (documentId: string, page: number) => PageSize | undefined,
  createId: () => string,
  offset = 12,
): Field[] {
  return fields.flatMap((f) => {
    const size = pageSize(f.documentId, f.page);
    if (!size) return [];
    const rect = roundRect(
      clampRect({ ...f.rect, x: f.rect.x + offset, y: f.rect.y + offset }, size),
    );
    return [{ ...f, id: createId(), rect }];
  });
}
