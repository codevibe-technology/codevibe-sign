import { describe, expect, it } from 'vitest';
import type { Field } from '@codevibe_technology/sign-core';
import { field } from '../test/fixtures';
import {
  fieldGroups,
  initialsOnEveryPage,
  pagesForChoice,
  parsePageRange,
  repeatField,
  scaleRectBetween,
  signatureOnLastPage,
} from './multipage';

const A4 = { width: 595, height: 842 };
const LETTER = { width: 612, height: 792 };
const A4_LANDSCAPE = { width: 842, height: 595 };

describe('parsePageRange', () => {
  it('reads pages and ranges, in order and without repeats', () => {
    expect(parsePageRange('1, 3, 5-7', 8)).toEqual({ pages: [0, 2, 4, 5, 6] });
    expect(parsePageRange(' 2 ; 2-3 ', 3)).toEqual({ pages: [1, 2] });
  });

  it('explains what is wrong', () => {
    expect(parsePageRange('', 3)).toEqual({ error: expect.stringMatching(/Enter page numbers/) });
    expect(parsePageRange('1, x', 3)).toEqual({ error: '“x” is not a page or a range like 5-7.' });
    expect(parsePageRange('0', 3)).toEqual({ error: 'Pages are counted from 1.' });
    expect(parsePageRange('5-2', 6)).toEqual({ error: '“5-2” runs backwards; write it as 2-5.' });
    expect(parsePageRange('2-9', 4)).toEqual({
      error: 'This document has 4 pages; 9 is past the end.',
    });
    expect(parsePageRange('2', 1)).toEqual({ error: 'This document has only 1 page.' });
  });
});

describe('pagesForChoice', () => {
  it('turns each choice into pages', () => {
    expect(pagesForChoice('this', 4, 2)).toEqual({ pages: [2] });
    expect(pagesForChoice('all', 3, 0)).toEqual({ pages: [0, 1, 2] });
    expect(pagesForChoice('except-first', 3, 0)).toEqual({ pages: [1, 2] });
    expect(pagesForChoice('last', 3, 0)).toEqual({ pages: [2] });
    expect(pagesForChoice('custom', 3, 0, '1-2')).toEqual({ pages: [0, 1] });
  });
});

describe('scaleRectBetween', () => {
  it('keeps the same spot on a page of another size', () => {
    const rect = { x: 487, y: 766, width: 72, height: 40 };
    const out = scaleRectBetween(rect, A4, LETTER);
    const centre = (r: typeof rect, p: typeof A4) => [
      (r.x + r.width / 2) / p.width,
      (r.y + r.height / 2) / p.height,
    ];
    const [ax, ay] = centre(rect, A4);
    const [bx, by] = centre(out, LETTER);
    expect(bx).toBeCloseTo(ax!, 2);
    expect(by).toBeCloseTo(ay!, 2);
    expect(out.width / out.height).toBeCloseTo(72 / 40, 1);
  });

  it('lands inside a rotated (landscape) page', () => {
    const out = scaleRectBetween({ x: 500, y: 780, width: 72, height: 40 }, A4, A4_LANDSCAPE);
    expect(out.x + out.width).toBeLessThanOrEqual(A4_LANDSCAPE.width);
    expect(out.y + out.height).toBeLessThanOrEqual(A4_LANDSCAPE.height);
    expect(out.y).toBeGreaterThan(A4_LANDSCAPE.height / 2);
  });
});

describe('groups', () => {
  const sizes = [A4, LETTER, A4];
  const size = (_doc: string, page: number) => sizes[page];
  let n = 0;
  const id = () => `c${++n}`;

  it('links copies made on other pages and finds them again from the fields alone', () => {
    const original = field('f1', 'initials', 'r1', { x: 487, y: 766, width: 72, height: 40 });
    const copies = repeatField(original, [0, 1, 2], (p) => sizes[p], id);
    expect(copies.map((c) => c.page)).toEqual([1, 2]);
    const all: Field[] = [original, ...copies, field('f9', 'initials', 'r2')];
    const groups = fieldGroups(all, size);
    expect(groups.get('f1')).toEqual(['f1', ...copies.map((c) => c.id)]);
    expect(groups.get('f9')).toBeUndefined();
  });

  it('skips pages that already have a copy', () => {
    const original = field('f1', 'initials', 'r1');
    expect(repeatField(original, [0, 1, 2], (p) => sizes[p], id, new Set([0, 1]))).toHaveLength(1);
  });

  it('does not group fields of other recipients or types at the same spot', () => {
    const a = field('a', 'initials', 'r1');
    const b = field('b', 'initials', 'r2', {}, { page: 1 });
    const c = field('c', 'signature', 'r1', {}, { page: 2 });
    expect(fieldGroups([a, b, c], size).size).toBe(0);
  });
});

describe('presets', () => {
  const pages = [A4, LETTER, A4_LANDSCAPE];
  let n = 0;
  const createId = () => `p${++n}`;

  it('puts initials in the bottom-right corner of every page', () => {
    const fields = initialsOnEveryPage({ documentId: 'doc', recipientId: 'r1', pages, createId });
    expect(fields.map((f) => [f.page, f.type, f.recipientId])).toEqual([
      [0, 'initials', 'r1'],
      [1, 'initials', 'r1'],
      [2, 'initials', 'r1'],
    ]);
    fields.forEach((f, i) => {
      expect(f.rect.x + f.rect.width).toBe(pages[i]!.width - 36);
      expect(f.rect.y + f.rect.height).toBe(pages[i]!.height - 36);
    });
  });

  it('puts one signature on the last page', () => {
    const [sig, ...rest] = signatureOnLastPage({
      documentId: 'doc',
      recipientId: 'r1',
      pages,
      createId,
    });
    expect(rest).toEqual([]);
    expect(sig).toMatchObject({ type: 'signature', page: 2, required: true });
    expect(sig!.rect.y + sig!.rect.height).toBeLessThanOrEqual(A4_LANDSCAPE.height - 36);
    expect(
      signatureOnLastPage({ documentId: 'doc', recipientId: 'r1', pages: [], createId }),
    ).toEqual([]);
  });
});
