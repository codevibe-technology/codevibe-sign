import { describe, expect, it } from 'vitest';
import {
  boxFrame,
  clampRect,
  fitContain,
  normalizeRotation,
  toUserSpace,
  type PageGeometry,
} from './geometry';

function geometry(
  rotation: PageGeometry['rotation'],
  box = { x: 0, y: 0, width: 600, height: 800 },
): PageGeometry {
  const sideways = rotation === 90 || rotation === 270;
  return {
    box,
    rotation,
    width: sideways ? box.height : box.width,
    height: sideways ? box.width : box.height,
  };
}

describe('toUserSpace', () => {
  it('flips the y axis on an upright page', () => {
    expect(toUserSpace(geometry(0), { x: 10, y: 20 })).toEqual({ x: 10, y: 780 });
  });

  it('maps the displayed corners of a page rotated 90 degrees', () => {
    const page = geometry(90);
    expect(toUserSpace(page, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(toUserSpace(page, { x: 800, y: 0 })).toEqual({ x: 0, y: 800 });
    expect(toUserSpace(page, { x: 0, y: 600 })).toEqual({ x: 600, y: 0 });
  });

  it('maps the displayed corners of a page rotated 180 degrees', () => {
    const page = geometry(180);
    expect(toUserSpace(page, { x: 0, y: 0 })).toEqual({ x: 600, y: 0 });
    expect(toUserSpace(page, { x: 600, y: 800 })).toEqual({ x: 0, y: 800 });
  });

  it('maps the displayed corners of a page rotated 270 degrees', () => {
    const page = geometry(270);
    expect(toUserSpace(page, { x: 0, y: 0 })).toEqual({ x: 600, y: 800 });
    expect(toUserSpace(page, { x: 800, y: 600 })).toEqual({ x: 0, y: 0 });
  });

  it('offsets by the crop box origin', () => {
    const page = geometry(0, { x: 20, y: 30, width: 500, height: 700 });
    expect(toUserSpace(page, { x: 0, y: 0 })).toEqual({ x: 20, y: 730 });
  });
});

describe('boxFrame', () => {
  it('puts the local origin at the displayed bottom-left of the box', () => {
    const rect = { x: 100, y: 50, width: 200, height: 40 };
    expect(boxFrame(geometry(0), rect).at(0, 0)).toEqual({ x: 100, y: 710 });
    expect(boxFrame(geometry(90), rect).at(0, 0)).toEqual({ x: 90, y: 100 });
    expect(boxFrame(geometry(90), rect).rotate).toBe(90);
  });
});

describe('normalizeRotation', () => {
  it('folds any multiple of 90 into 0 to 270', () => {
    expect([0, 90, 180, 270, 360, -90, 450].map(normalizeRotation)).toEqual([
      0, 90, 180, 270, 0, 270, 90,
    ]);
  });
});

describe('fitContain', () => {
  it('keeps the aspect ratio of a wide image and centres it vertically', () => {
    expect(fitContain(400, 100, 200, 100)).toEqual({ x: 0, y: 25, width: 200, height: 50 });
  });

  it('keeps the aspect ratio of a tall image and centres it horizontally', () => {
    expect(fitContain(100, 100, 200, 50)).toEqual({ x: 75, y: 0, width: 50, height: 50 });
  });

  it('scales small images up to the box', () => {
    expect(fitContain(10, 5, 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('returns an empty placement for empty input', () => {
    expect(fitContain(0, 10, 100, 100).width).toBe(0);
  });
});

describe('clampRect', () => {
  const page = geometry(0);

  it('keeps a rect that is inside the page', () => {
    expect(clampRect(page, { x: 10, y: 10, width: 50, height: 20 })).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 20,
    });
  });

  it('trims a rect that runs off the page', () => {
    expect(clampRect(page, { x: 580, y: -5, width: 50, height: 20 })).toEqual({
      x: 580,
      y: 0,
      width: 20,
      height: 15,
    });
  });

  it('rejects rects outside the page or without area', () => {
    expect(clampRect(page, { x: 700, y: 10, width: 50, height: 20 })).toBeNull();
    expect(clampRect(page, { x: 10, y: 10, width: 0, height: 20 })).toBeNull();
    expect(clampRect(page, { x: Number.NaN, y: 10, width: 10, height: 20 })).toBeNull();
  });
});
