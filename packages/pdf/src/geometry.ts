import type { PDFPage } from 'pdf-lib';
import type { Rect } from '@codevibe/sign-core';

export type Rotation = 0 | 90 | 180 | 270;

/** A page as the reader sees it: crop box in user space plus the clockwise display rotation. */
export interface PageGeometry {
  /** Crop box origin and size in unrotated user space. */
  box: { x: number; y: number; width: number; height: number };
  rotation: Rotation;
  /** Displayed width and height (swapped for 90 and 270). */
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function normalizeRotation(angle: number): Rotation {
  const quarter = Math.round(angle / 90);
  const normalized = (((quarter % 4) + 4) % 4) * 90;
  return normalized as Rotation;
}

export function pageGeometry(page: PDFPage): PageGeometry {
  const box = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  const sideways = rotation === 90 || rotation === 270;
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    rotation,
    width: sideways ? box.height : box.width,
    height: sideways ? box.width : box.height,
  };
}

/**
 * Maps a point given in displayed, top-left-origin coordinates to PDF user space
 * (bottom-left origin, before the page's /Rotate is applied).
 */
export function toUserSpace(geometry: PageGeometry, point: Point): Point {
  const { box, rotation } = geometry;
  switch (rotation) {
    case 0:
      return { x: box.x + point.x, y: box.y + box.height - point.y };
    case 90:
      return { x: box.x + point.y, y: box.y + point.x };
    case 180:
      return { x: box.x + box.width - point.x, y: box.y + point.y };
    case 270:
      return { x: box.x + box.width - point.y, y: box.y + box.height - point.x };
  }
}

/**
 * Clamps a displayed rect to the page. Returns null when nothing of it is left
 * (or it is not a finite, positive box).
 */
export function clampRect(geometry: PageGeometry, rect: Rect): Rect | null {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (values.some((value) => !Number.isFinite(value)) || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(geometry.width, rect.x + rect.width);
  const bottom = Math.min(geometry.height, rect.y + rect.height);
  if (right - left <= 0 || bottom - top <= 0) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A drawing frame for one field box: local coordinates have their origin at the
 * box's displayed bottom-left corner, x to the right and y up, as the reader sees it.
 * `at` returns the user-space point and `rotate` the angle (counter-clockwise, degrees)
 * to pass to pdf-lib so content appears upright on a rotated page.
 */
export interface BoxFrame {
  width: number;
  height: number;
  rotate: number;
  at(localX: number, localY: number): Point;
}

export function boxFrame(geometry: PageGeometry, rect: Rect): BoxFrame {
  return {
    width: rect.width,
    height: rect.height,
    rotate: geometry.rotation,
    at(localX, localY) {
      return toUserSpace(geometry, { x: rect.x + localX, y: rect.y + rect.height - localY });
    },
  };
}

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Largest size of a `width` x `height` item that fits the box, keeping its aspect ratio, centred. */
export function fitContain(
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
): Placement {
  if (width <= 0 || height <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;
  return {
    x: (boxWidth - fittedWidth) / 2,
    y: (boxHeight - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}
