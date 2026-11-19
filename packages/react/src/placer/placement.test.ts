import { describe, expect, it } from 'vitest';
import { createField, defaultFieldSizes, nudgeRect, placeRect, sizeRect } from './placement';

const letter = { width: 612, height: 792 };

describe('createField', () => {
  it('centres the field on the drop point in points', () => {
    const field = createField({
      id: 'f1',
      documentId: 'd1',
      recipientId: 'r1',
      type: 'signature',
      page: 1,
      center: { x: 306, y: 396 },
      size: defaultFieldSizes.signature,
      pageSize: letter,
    });
    expect(field).toEqual({
      id: 'f1',
      documentId: 'd1',
      recipientId: 'r1',
      type: 'signature',
      page: 1,
      rect: { x: 216, y: 369, width: 180, height: 54 },
      required: true,
    });
  });

  it('keeps a field dropped near an edge on the page', () => {
    const field = createField({
      id: 'f1',
      documentId: 'd1',
      recipientId: 'r1',
      type: 'checkbox',
      page: 0,
      center: { x: 610, y: 2 },
      size: defaultFieldSizes.checkbox,
      pageSize: letter,
    });
    expect(field.rect).toEqual({ x: 594, y: 0, width: 18, height: 18 });
    expect(field.required).toBe(false);
  });
});

describe('nudgeRect', () => {
  const rect = { x: 100, y: 100, width: 50, height: 20 };

  it('moves by the step in the arrow direction', () => {
    expect(nudgeRect(rect, 'ArrowRight', 1, letter)).toMatchObject({ x: 101, y: 100 });
    expect(nudgeRect(rect, 'ArrowLeft', 10, letter)).toMatchObject({ x: 90, y: 100 });
    expect(nudgeRect(rect, 'ArrowUp', 1, letter)).toMatchObject({ x: 100, y: 99 });
    expect(nudgeRect(rect, 'ArrowDown', 10, letter)).toMatchObject({ x: 100, y: 110 });
  });

  it('stops at the page edge without snapping', () => {
    expect(nudgeRect({ ...rect, x: 0.5 }, 'ArrowLeft', 10, letter).x).toBe(0);
    expect(nudgeRect({ ...rect, x: 3 }, 'ArrowRight', 1, letter).x).toBe(4);
  });

  it('resizes instead of moving when asked', () => {
    expect(nudgeRect(rect, 'ArrowRight', 10, letter, { resize: true })).toEqual({
      x: 100,
      y: 100,
      width: 60,
      height: 20,
    });
    expect(nudgeRect(rect, 'ArrowUp', 10, letter, { resize: true, minSize: 12 }).height).toBe(12);
  });
});

describe('placeRect and sizeRect', () => {
  it('rounds to hundredths of a point', () => {
    expect(placeRect({ x: 100.123456, y: 200.987654, width: 50, height: 20 }, letter, 0)).toEqual({
      x: 100.12,
      y: 200.99,
      width: 50,
      height: 20,
    });
    expect(sizeRect({ x: 10, y: 10, width: 50, height: 20 }, 60.555, 20.444, letter, 8, 0)).toEqual(
      {
        x: 10,
        y: 10,
        width: 60.56,
        height: 20.44,
      },
    );
  });
});
