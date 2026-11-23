import type { Field, FieldType, Rect } from '@codevibe_technology/sign-core';
import { clampRect, resizeRect, roundRect, snapToPageEdges, type PageSize } from '../geometry';

export interface Size {
  width: number;
  height: number;
}

/** Default field sizes in PDF points (72 points to the inch). */
export const defaultFieldSizes: Record<FieldType, Size> = {
  signature: { width: 180, height: 54 },
  initials: { width: 72, height: 40 },
  date_signed: { width: 110, height: 22 },
  name: { width: 160, height: 22 },
  text: { width: 160, height: 22 },
  checkbox: { width: 18, height: 18 },
  aadhaar: { width: 200, height: 64 },
};

export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

export interface NewFieldInput {
  id: string;
  documentId: string;
  recipientId: string;
  type: FieldType;
  page: number;
  /** Where the centre of the field should land, in page points. */
  center: { x: number; y: number };
  size: Size;
  pageSize: PageSize;
  required?: boolean;
  /** Rects already on the page; given these, the field is moved clear of them. */
  avoid?: Rect[];
}

export function createField(input: NewFieldInput): Field {
  const wanted = clampRect(
    {
      x: input.center.x - input.size.width / 2,
      y: input.center.y - input.size.height / 2,
      width: input.size.width,
      height: input.size.height,
    },
    input.pageSize,
  );
  const rect = input.avoid ? freeRect(wanted, input.avoid, input.pageSize) : wanted;
  return {
    id: input.id,
    documentId: input.documentId,
    recipientId: input.recipientId,
    type: input.type,
    page: input.page,
    rect: roundRect(rect),
    required: input.required ?? input.type !== 'checkbox',
  };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * A spot for a new field that does not sit on top of the fields already on the page: `rect`
 * itself when it is free, else the nearest free place below it, then above it. When the page
 * has no room in that column the rect comes back unchanged.
 */
export function freeRect(rect: Rect, taken: Rect[], page: PageSize, gap = 12): Rect {
  const start = clampRect(rect, page);
  const free = (candidate: Rect) => !taken.some((other) => overlaps(candidate, other));
  if (free(start)) return start;
  const step = start.height + gap;
  for (const direction of [1, -1]) {
    for (
      let y = start.y + direction * step;
      y >= 0 && y + start.height <= page.height;
      y += direction * step
    ) {
      const candidate = { ...start, y };
      if (free(candidate)) return candidate;
    }
  }
  return start;
}

/** Moves a field to `rect` (same size), snapping to page edges and keeping it on the page. */
export function placeRect(rect: Rect, page: PageSize, snapThreshold: number): Rect {
  return roundRect(snapToPageEdges(rect, page, snapThreshold));
}

export function sizeRect(
  rect: Rect,
  width: number,
  height: number,
  page: PageSize,
  minSize: number,
  snapThreshold: number,
): Rect {
  return roundRect(resizeRect(rect, width, height, page, minSize, snapThreshold));
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/**
 * Moves (or, with `resize`, grows and shrinks) a rect by `step` points in the
 * arrow's direction. Nudging never snaps, so a field can sit a point from an edge.
 */
export function nudgeRect(
  rect: Rect,
  key: ArrowKey,
  step: number,
  page: PageSize,
  options: { resize?: boolean; minSize?: number } = {},
): Rect {
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  if (options.resize) {
    return sizeRect(rect, rect.width + dx, rect.height + dy, page, options.minSize ?? 8, 0);
  }
  return roundRect(clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, page));
}
