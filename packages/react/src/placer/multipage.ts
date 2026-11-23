import type { Field, FieldType, Rect } from '@codevibe_technology/sign-core';
import { clampRect, roundRect, type PageSize } from '../geometry';
import { defaultFieldSizes, type Size } from './placement';

/** Which pages a field shows on: only its own, every page, or a typed list. */
export type RepeatChoice = 'this' | 'all' | 'custom';

export type PageList = { pages: number[] } | { error: string };

const RANGE = /^(\d+)\s*(?:-\s*(\d+))?$/;

/**
 * Parses page numbers as people type them, "1, 3, 5-7", into zero-based page indexes in
 * order, without repeats. Pages are counted from 1 and must exist.
 */
export function parsePageRange(text: string, pageCount: number): PageList {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { error: 'Enter page numbers, for example 1, 3, 5-7.' };
  const pages = new Set<number>();
  for (const part of parts) {
    const match = RANGE.exec(part);
    if (!match) return { error: `“${part}” is not a page or a range like 5-7.` };
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < 1) return { error: 'Pages are counted from 1.' };
    if (to < from) return { error: `“${part}” runs backwards; write it as ${to}-${from}.` };
    if (to > pageCount) {
      return {
        error:
          pageCount === 1
            ? 'This document has only 1 page.'
            : `This document has ${pageCount} pages; ${to} is past the end.`,
      };
    }
    for (let page = from; page <= to; page++) pages.add(page - 1);
  }
  return { pages: [...pages].sort((a, b) => a - b) };
}

/** Zero-based pages written the way people type them: `[0, 2, 4, 5, 6]` reads "1, 3, 5-7". */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i]!;
    let to = from;
    while (sorted[i + 1] === to + 1) to = sorted[++i]!;
    parts.push(
      to === from
        ? `${from + 1}`
        : to === from + 1
          ? `${from + 1}, ${to + 1}`
          : `${from + 1}-${to + 1}`,
    );
  }
  return parts.join(', ');
}

/** The choice that describes a field already shown on `pages` of a `pageCount` page document. */
export function choiceForPages(pages: number[], pageCount: number): RepeatChoice {
  const count = new Set(pages).size;
  if (count <= 1) return 'this';
  return count >= pageCount ? 'all' : 'custom';
}

/** The pages a "Show on pages" choice stands for, zero-based. */
export function pagesForChoice(
  choice: RepeatChoice,
  pageCount: number,
  current: number,
  custom = '',
): PageList {
  const every = Array.from({ length: pageCount }, (_, i) => i);
  switch (choice) {
    case 'this':
      return { pages: [current] };
    case 'all':
      return { pages: every };
    case 'custom':
      return parsePageRange(custom, pageCount);
  }
}

/**
 * The same spot on another page: the rect keeps its position and size relative to the page,
 * so a field near the bottom-right corner of an A4 page lands near the corner of a Letter
 * page too. Sizes are the pages as displayed, so a rotated page is already accounted for.
 */
export function scaleRectBetween(rect: Rect, from: PageSize, to: PageSize): Rect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  // Keep the field's shape: scale both sides by the smaller factor, and its position by each.
  const s = Math.min(sx, sy);
  const width = rect.width * s;
  const height = rect.height * s;
  const cx = (rect.x + rect.width / 2) * sx;
  const cy = (rect.y + rect.height / 2) * sy;
  return roundRect(clampRect({ x: cx - width / 2, y: cy - height / 2, width, height }, to));
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;

/** Where a field sits as fractions of its page, to compare positions across page sizes. */
function relative(field: Field, size: PageSize) {
  return {
    x: (field.rect.x + field.rect.width / 2) / size.width,
    y: (field.rect.y + field.rect.height / 2) / size.height,
  };
}

/**
 * Groups of linked copies: fields of the same document, recipient and type at the same spot on
 * different pages. Derived from the fields alone, so a group survives a reload and the fields
 * stay plain fields. Returns, for each grouped field id, the ids of its whole group.
 */
export function fieldGroups(
  fields: Field[],
  pageSize: (documentId: string, page: number) => PageSize | undefined,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.id)) continue;
    const size = pageSize(field.documentId, field.page);
    if (!size) continue;
    const at = relative(field, size);
    const members = fields.filter((other) => {
      if (other.documentId !== field.documentId) return false;
      if (other.recipientId !== field.recipientId || other.type !== field.type) return false;
      const otherSize = pageSize(other.documentId, other.page);
      if (!otherSize) return false;
      const there = relative(other, otherSize);
      return near(there.x, at.x) && near(there.y, at.y);
    });
    const pages = new Set(members.map((m) => m.page));
    if (members.length < 2 || pages.size !== members.length) continue;
    const ids = members.map((m) => m.id);
    for (const id of ids) {
      seen.add(id);
      groups.set(id, ids);
    }
  }
  return groups;
}

/** Copies of `field` on `pages`, skipping its own page and pages that already have a copy. */
export function repeatField(
  field: Field,
  pages: number[],
  pageSize: (page: number) => PageSize | undefined,
  createId: () => string,
  existingPages: ReadonlySet<number> = new Set([field.page]),
): Field[] {
  const from = pageSize(field.page);
  if (!from) return [];
  return pages
    .filter((page) => !existingPages.has(page))
    .flatMap((page) => {
      const to = pageSize(page);
      if (!to) return [];
      return [{ ...field, id: createId(), page, rect: scaleRectBetween(field.rect, from, to) }];
    });
}

const MARGIN = 36;

function cornerRect(size: Size, page: PageSize, corner: 'bottom-right' | 'bottom-left'): Rect {
  const x = corner === 'bottom-right' ? page.width - MARGIN - size.width : MARGIN + 18;
  return roundRect(
    clampRect(
      { x, y: page.height - MARGIN - size.height, width: size.width, height: size.height },
      page,
    ),
  );
}

export interface PresetInput {
  documentId: string;
  recipientId: string;
  pages: PageSize[];
  createId: () => string;
  sizes?: Partial<Record<FieldType, Size>>;
}

/** "Initials on every page": an initials box in the bottom-right corner of each page. */
export function initialsOnEveryPage(input: PresetInput): Field[] {
  const size = input.sizes?.initials ?? defaultFieldSizes.initials;
  return input.pages.map((page, index) => ({
    id: input.createId(),
    documentId: input.documentId,
    recipientId: input.recipientId,
    type: 'initials',
    page: index,
    rect: cornerRect(size, page, 'bottom-right'),
    required: true,
  }));
}

/** "Signature on last page": a signature box near the bottom-left corner of the last page. */
export function signatureOnLastPage(input: PresetInput): Field[] {
  const type = 'signature';
  const last = input.pages.length - 1;
  const page = input.pages[last];
  if (!page) return [];
  const size = input.sizes?.[type] ?? defaultFieldSizes[type];
  // Above the initials row, so both presets can be used together.
  const rect = cornerRect(size, page, 'bottom-left');
  return [
    {
      id: input.createId(),
      documentId: input.documentId,
      recipientId: input.recipientId,
      type,
      page: last,
      rect: roundRect(clampRect({ ...rect, y: rect.y - 48 }, page)),
      required: true,
    },
  ];
}
