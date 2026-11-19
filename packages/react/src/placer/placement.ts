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
}

export function createField(input: NewFieldInput): Field {
  const rect = clampRect(
    {
      x: input.center.x - input.size.width / 2,
      y: input.center.y - input.size.height / 2,
      width: input.size.width,
      height: input.size.height,
    },
    input.pageSize,
  );
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
