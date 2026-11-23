import { describe, expect, it } from 'vitest';
import type { Field } from '@codevibe_technology/sign-core';
import { alignRect, pasteCopies, resizeFromCorner } from './align';

const page = { width: 600, height: 800 };

describe('alignRect', () => {
  it('lines a field up with the left edge of a neighbour', () => {
    const other = { x: 100, y: 400, width: 120, height: 30 };
    const { rect, guides } = alignRect({ x: 104, y: 200, width: 80, height: 20 }, [other], page, 6);
    expect(rect.x).toBe(100);
    expect(guides).toContainEqual({ axis: 'x', at: 100 });
  });

  it('lines up centres and bottoms as well as starts', () => {
    const other = { x: 300, y: 100, width: 100, height: 40 };
    const { rect, guides } = alignRect({ x: 323, y: 118, width: 50, height: 20 }, [other], page, 6);
    expect(rect.x + rect.width / 2).toBe(350);
    expect(rect.y + rect.height).toBe(140);
    expect(guides).toHaveLength(2);
  });

  it('leaves a field alone when nothing is close', () => {
    const start = { x: 200, y: 300, width: 80, height: 20 };
    const { rect, guides } = alignRect(start, [{ x: 10, y: 10, width: 40, height: 10 }], page, 4);
    expect(rect).toEqual(start);
    expect(guides).toEqual([]);
  });

  it('snaps to the page centre', () => {
    const { rect } = alignRect({ x: 257, y: 500, width: 80, height: 20 }, [], page, 6);
    expect(rect.x + rect.width / 2).toBe(300);
  });

  it('keeps the field on the page', () => {
    const { rect } = alignRect({ x: -30, y: 790, width: 80, height: 20 }, [], page, 2);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(780);
  });
});

describe('resizeFromCorner', () => {
  const rect = { x: 100, y: 100, width: 100, height: 50 };

  it('grows from the bottom-right corner', () => {
    expect(resizeFromCorner(rect, 'se', 20, 10, page, 8)).toEqual({
      x: 100,
      y: 100,
      width: 120,
      height: 60,
    });
  });

  it('keeps the opposite corner fixed when dragging the top-left', () => {
    const next = resizeFromCorner(rect, 'nw', -20, -10, page, 8);
    expect(next).toEqual({ x: 80, y: 90, width: 120, height: 60 });
  });

  it('never shrinks under the minimum size', () => {
    const next = resizeFromCorner(rect, 'ne', -500, 500, page, 8);
    expect(next.width).toBe(8);
    expect(next.y).toBe(142);
    expect(next.height).toBe(8);
  });

  it('stops at the page edge', () => {
    expect(resizeFromCorner(rect, 'sw', -500, 5000, page, 8)).toEqual({
      x: 0,
      y: 100,
      width: 200,
      height: 700,
    });
  });
});

describe('pasteCopies', () => {
  const field: Field = {
    id: 'a',
    documentId: 'doc',
    recipientId: 'r1',
    type: 'text',
    page: 0,
    rect: { x: 580, y: 10, width: 40, height: 20 },
    required: true,
    label: 'Email',
  };

  it('copies with a new id, offset and kept on the page', () => {
    let n = 0;
    const [copy] = pasteCopies(
      [field],
      () => page,
      () => `copy-${++n}`,
    );
    expect(copy).toMatchObject({ id: 'copy-1', label: 'Email', recipientId: 'r1', page: 0 });
    expect(copy!.rect).toEqual({ x: 560, y: 22, width: 40, height: 20 });
  });

  it('skips fields whose page is unknown', () => {
    expect(
      pasteCopies(
        [field],
        () => undefined,
        () => 'x',
      ),
    ).toEqual([]);
  });
});
