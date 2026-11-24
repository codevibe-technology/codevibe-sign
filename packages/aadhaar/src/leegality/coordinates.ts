import { SignError } from '@codevibe_technology/sign-core';
import type { PageBox, SignaturePosition } from '../provider';

/**
 * How Leegality reads the numbers of a signature rectangle.
 *
 * The v4 Pack API documents the rectangle only as `{ x1Axis, y1Axis, x2Axis, y2Axis }`, "first
 * corner" and "opposite corner", with the sample `350, 680, 550, 720` on page 1
 * (https://knowledge.leegality.com/document-execution/api/create-pack-sync). It does not name
 * the unit or the origin. Leegality's earlier API described the same rectangle as the
 * "lower-left" and "upper-right" corners in whole numbers, which is PDF user space: points from
 * the bottom-left corner of the page (v2.1 OpenAPI schema `Appearance`, published copy at
 * https://github.com/prakharmittal/leegality-apidocs/blob/master/api_2_1.json). That is the
 * default here; one test eSign with a box at a known place confirms it (see the Aadhaar eSign
 * guide), and the mapping can be changed without a code change if it does not.
 */
export interface CoordinateMapping {
  /** `points` (1/72 inch, PDF user space) or pixels at a given resolution. */
  units: 'points' | { pixelsPerInch: number };
  /**
   * `bottom-left`: PDF user space of the unrotated page, y up, as signature libraries place an
   * appearance. `top-left`: the page as it is displayed (rotation applied), y down.
   */
  origin: 'bottom-left' | 'top-left';
}

export const DEFAULT_COORDINATE_MAPPING: CoordinateMapping = {
  units: 'points',
  origin: 'bottom-left',
};

export interface LeegalityRect {
  x1Axis: string;
  y1Axis: string;
  x2Axis: string;
  y2Axis: string;
}

/** Reads `points` or `pixels@<dpi>` (for example `pixels@96`). */
export function parseCoordinateUnits(value: string): CoordinateMapping['units'] {
  const text = value.trim().toLowerCase();
  if (text === 'points') return 'points';
  const match = /^pixels@(\d{2,4})$/.exec(text);
  const dpi = match ? Number(match[1]) : NaN;
  if (Number.isInteger(dpi) && dpi >= 36 && dpi <= 1200) return { pixelsPerInch: dpi };
  throw new SignError(
    'VALIDATION',
    'Coordinate units must be points or pixels@<dpi>, e.g. pixels@96',
    {
      option: 'coordinates.units',
    },
  );
}

export function parseCoordinateOrigin(value: string): CoordinateMapping['origin'] {
  const text = value.trim().toLowerCase();
  if (text === 'bottom-left' || text === 'top-left') return text;
  throw new SignError('VALIDATION', 'Coordinate origin must be bottom-left or top-left', {
    option: 'coordinates.origin',
  });
}

export function describeMapping(mapping: CoordinateMapping): string {
  const units = mapping.units === 'points' ? 'points' : `pixels@${mapping.units.pixelsPerInch}`;
  return `${units}, ${mapping.origin}`;
}

interface Point {
  x: number;
  y: number;
}

/** A displayed, top-left-origin point mapped to PDF user space of the unrotated page. */
function toUserSpace(box: PageBox, point: Point): Point {
  switch (box.rotation) {
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

function valid(position: SignaturePosition): boolean {
  const { page, rect } = position;
  const numbers = [rect.x, rect.y, rect.width, rect.height];
  return (
    Number.isInteger(page) &&
    page >= 0 &&
    numbers.every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

const text = (value: number) => String(Math.round(value));

/**
 * Converts a box placed on the displayed page (PDF points, top-left origin, as `Field.rect`)
 * to the rectangle Leegality takes. A bottom-left origin needs the position's `pageBox`.
 */
export function toLeegalityRect(
  position: SignaturePosition,
  mapping: CoordinateMapping = DEFAULT_COORDINATE_MAPPING,
): LeegalityRect {
  if (!valid(position)) {
    throw new SignError('VALIDATION', 'The signature position is not a box on a page', {
      field: 'signaturePositions',
    });
  }
  const { rect } = position;
  const scale = mapping.units === 'points' ? 1 : mapping.units.pixelsPerInch / 72;
  if (mapping.origin === 'top-left') {
    return {
      x1Axis: text(rect.x * scale),
      y1Axis: text(rect.y * scale),
      x2Axis: text((rect.x + rect.width) * scale),
      y2Axis: text((rect.y + rect.height) * scale),
    };
  }
  // Measuring from the bottom needs the page height, which only the page box gives.
  const box = position.pageBox;
  if (!box) {
    throw new SignError('VALIDATION', 'The page size is needed to place the signature', {
      field: 'signaturePositions.pageBox',
    });
  }
  const a = toUserSpace(box, { x: rect.x, y: rect.y });
  const b = toUserSpace(box, { x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x1Axis: text(Math.min(a.x, b.x) * scale),
    y1Axis: text(Math.min(a.y, b.y) * scale),
    x2Axis: text(Math.max(a.x, b.x) * scale),
    y2Axis: text(Math.max(a.y, b.y) * scale),
  };
}
