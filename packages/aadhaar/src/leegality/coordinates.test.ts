import { describe, expect, it } from 'vitest';
import type { PageBox, SignaturePosition } from '../provider';
import {
  describeMapping,
  parseCoordinateOrigin,
  parseCoordinateUnits,
  toLeegalityRect,
  type CoordinateMapping,
} from './coordinates';

const A4: PageBox = { x: 0, y: 0, width: 595, height: 842, rotation: 0 };
const box = { x: 72, y: 600, width: 160, height: 48 };
const at = (pageBox: PageBox, rect = box, page = 0): SignaturePosition => ({
  page,
  rect,
  pageBox,
});
const rect = (x1: number, y1: number, x2: number, y2: number) => ({
  x1Axis: String(x1),
  y1Axis: String(y1),
  x2Axis: String(x2),
  y2Axis: String(y2),
});

const POINTS_BOTTOM: CoordinateMapping = { units: 'points', origin: 'bottom-left' };
const POINTS_TOP: CoordinateMapping = { units: 'points', origin: 'top-left' };

describe('toLeegalityRect', () => {
  it('measures from the bottom-left corner in points by default', () => {
    expect(toLeegalityRect(at(A4))).toEqual(rect(72, 194, 232, 242));
  });

  it('keeps the displayed numbers for a top-left origin', () => {
    expect(toLeegalityRect(at(A4), POINTS_TOP)).toEqual(rect(72, 600, 232, 648));
  });

  it('scales to pixels at the given resolution', () => {
    const pixels: CoordinateMapping = { units: { pixelsPerInch: 96 }, origin: 'top-left' };
    expect(toLeegalityRect(at(A4), pixels)).toEqual(rect(96, 800, 309, 864));
    const bottom: CoordinateMapping = { units: { pixelsPerInch: 144 }, origin: 'bottom-left' };
    expect(toLeegalityRect(at(A4), bottom)).toEqual(rect(144, 388, 464, 484));
  });

  it('adds the offset of a crop box that does not start at the origin', () => {
    const cropped: PageBox = { x: 20, y: 30, width: 595, height: 842, rotation: 0 };
    expect(toLeegalityRect(at(cropped), POINTS_BOTTOM)).toEqual(rect(92, 224, 252, 272));
    // The displayed page starts at the crop box, so top-left numbers do not move.
    expect(toLeegalityRect(at(cropped), POINTS_TOP)).toEqual(rect(72, 600, 232, 648));
  });

  describe('on a rotated page', () => {
    // A portrait page turned to landscape: displayed 842 wide and 595 high.
    const turned = (rotation: PageBox['rotation']): PageBox => ({ ...A4, rotation });
    const shown = { x: 100, y: 50, width: 160, height: 48 };

    it('maps a 90 degree page into unrotated user space', () => {
      expect(toLeegalityRect(at(turned(90), shown), POINTS_BOTTOM)).toEqual(rect(50, 100, 98, 260));
    });

    it('maps a 180 degree page', () => {
      expect(toLeegalityRect(at(turned(180), shown), POINTS_BOTTOM)).toEqual(
        rect(335, 50, 495, 98),
      );
    });

    it('maps a 270 degree page', () => {
      expect(toLeegalityRect(at(turned(270), shown), POINTS_BOTTOM)).toEqual(
        rect(497, 582, 545, 742),
      );
    });

    it('keeps the page as displayed for a top-left origin', () => {
      expect(toLeegalityRect(at(turned(90), shown), POINTS_TOP)).toEqual(rect(100, 50, 260, 98));
    });
  });

  it('places each page of a multi-page document by its own size', () => {
    const letter: PageBox = { x: 0, y: 0, width: 612, height: 792, rotation: 0 };
    expect(toLeegalityRect(at(A4, box, 0))).toEqual(rect(72, 194, 232, 242));
    expect(toLeegalityRect(at(letter, box, 2))).toEqual(rect(72, 144, 232, 192));
  });

  it('refuses a box that is not on a page', () => {
    for (const bad of [
      { ...at(A4), page: -1 },
      { ...at(A4), page: 1.5 },
      at(A4, { ...box, width: 0 }),
      at(A4, { ...box, height: Number.NaN }),
    ]) {
      expect(() => toLeegalityRect(bad)).toThrow(/not a box on a page/);
    }
  });

  it('needs the page box to measure from the bottom', () => {
    expect(() => toLeegalityRect({ page: 0, rect: box })).toThrow(/page size is needed/);
    expect(toLeegalityRect({ page: 0, rect: box }, POINTS_TOP)).toEqual(rect(72, 600, 232, 648));
  });
});

describe('parsing the coordinate settings', () => {
  it('reads points and pixels at a resolution', () => {
    expect(parseCoordinateUnits('points')).toBe('points');
    expect(parseCoordinateUnits(' Pixels@96 ')).toEqual({ pixelsPerInch: 96 });
    for (const bad of ['', 'px', 'pixels', 'pixels@0', 'pixels@5000', 'inches']) {
      expect(() => parseCoordinateUnits(bad)).toThrow(/points or pixels@<dpi>/);
    }
  });

  it('reads the two origins', () => {
    expect(parseCoordinateOrigin('bottom-left')).toBe('bottom-left');
    expect(parseCoordinateOrigin('TOP-LEFT')).toBe('top-left');
    expect(() => parseCoordinateOrigin('centre')).toThrow(/bottom-left or top-left/);
  });

  it('describes a mapping the way it is configured', () => {
    expect(describeMapping(POINTS_BOTTOM)).toBe('points, bottom-left');
    expect(describeMapping({ units: { pixelsPerInch: 96 }, origin: 'top-left' })).toBe(
      'pixels@96, top-left',
    );
  });
});
