import { describe, expect, it } from 'vitest';
import {
  clampRect,
  clientToPoints,
  flipVertical,
  pixelsToPoints,
  pointsToPixels,
  resizeRect,
  scaleForWidth,
  snapToPageEdges,
} from './geometry';

const letter = { width: 612, height: 792 };
const a4 = { width: 595.28, height: 841.89 };

describe('unit conversion', () => {
  it('derives CSS pixels per point from the displayed width', () => {
    expect(scaleForWidth(letter, 612)).toBe(1);
    expect(scaleForWidth(letter, 816)).toBeCloseTo(96 / 72, 10);
    expect(scaleForWidth({ width: 0, height: 0 }, 500)).toBe(1);
  });

  it('maps points to pixels with the top-left origin kept', () => {
    expect(pointsToPixels({ x: 72, y: 144, width: 180, height: 54 }, 2)).toEqual({
      left: 144,
      top: 288,
      width: 360,
      height: 108,
    });
  });

  it.each([0.37, 0.5, 1, 4 / 3, 1.7321, 3])(
    'round-trips points through pixels at scale %s',
    (scale) => {
      const rect = { x: 71.5, y: 703.25, width: 181.3, height: 40.01 };
      const back = pixelsToPoints(pointsToPixels(rect, scale), scale);
      expect(back.x).toBeCloseTo(rect.x, 9);
      expect(back.y).toBeCloseTo(rect.y, 9);
      expect(back.width).toBeCloseTo(rect.width, 9);
      expect(back.height).toBeCloseTo(rect.height, 9);
    },
  );

  it('converts a pointer position on a scrolled, offset page to points', () => {
    const scale = scaleForWidth(a4, 800);
    const box = { left: 130, top: -420 };
    const p = clientToPoints(130 + 400, -420 + 600, box, scale);
    expect(p.x).toBeCloseTo(400 / scale, 9);
    expect(p.y).toBeCloseTo(600 / scale, 9);
    expect(p.x).toBeCloseTo(a4.width / 2, 9);
  });

  it('flips to the bottom-left PDF origin and back', () => {
    const rect = { x: 50, y: 100, width: 200, height: 60 };
    const flipped = flipVertical(rect, letter);
    expect(flipped).toEqual({ x: 50, y: 632, width: 200, height: 60 });
    expect(flipVertical(flipped, letter)).toEqual(rect);
  });
});

describe('clampRect', () => {
  it('keeps a rect inside the page', () => {
    expect(clampRect({ x: -10, y: 780, width: 100, height: 30 }, letter)).toEqual({
      x: 0,
      y: 762,
      width: 100,
      height: 30,
    });
  });

  it('shrinks a rect larger than the page', () => {
    expect(clampRect({ x: 5, y: 5, width: 900, height: 1000 }, letter)).toEqual({
      x: 0,
      y: 0,
      width: 612,
      height: 792,
    });
  });
});

describe('snapToPageEdges', () => {
  it('snaps edges within the threshold', () => {
    expect(snapToPageEdges({ x: 4, y: 790 - 30 + 1, width: 100, height: 30 }, letter, 6)).toEqual({
      x: 0,
      y: 762,
      width: 100,
      height: 30,
    });
    expect(snapToPageEdges({ x: 612 - 100 - 5, y: 3, width: 100, height: 30 }, letter, 6)).toEqual({
      x: 512,
      y: 0,
      width: 100,
      height: 30,
    });
  });

  it('leaves rects outside the threshold where they are', () => {
    const rect = { x: 20, y: 300, width: 100, height: 30 };
    expect(snapToPageEdges(rect, letter, 6)).toEqual(rect);
  });
});

describe('resizeRect', () => {
  it('respects the minimum size and the page edge', () => {
    const rect = { x: 500, y: 100, width: 50, height: 20 };
    expect(resizeRect(rect, 2, 2, letter, 8)).toEqual({ x: 500, y: 100, width: 8, height: 8 });
    expect(resizeRect(rect, 400, 20, letter, 8)).toEqual({
      x: 500,
      y: 100,
      width: 112,
      height: 20,
    });
  });

  it('snaps the dragged corner to the page edge', () => {
    const rect = { x: 500, y: 100, width: 50, height: 20 };
    expect(resizeRect(rect, 108, 20, letter, 8, 6).width).toBe(112);
  });
});
