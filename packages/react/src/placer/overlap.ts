import type { Field, FieldType, Rect } from '@codevibe_technology/sign-core';
import type { TextItem } from '../pdf/types';

/** Field types drawn as an image, which would hide whatever text lies under them. */
export const OVERLAP_CHECKED_TYPES: readonly FieldType[] = ['signature', 'initials'];

/** Covering this share of a line's height, and at least two of its characters, hides it. */
const MIN_HEIGHT_SHARE = 0.5;
const MIN_CHARACTERS = 2;

// Signature lines ("______", ". . . .") and field tags are meant to sit under a field.
const TAGS = /\{\{[^}]*\}\}/g;
const NOT_TEXT = /[\s_.\-\u2013\u2014\u00b7:]/g;

function overlap(start: number, length: number, otherStart: number, otherLength: number) {
  return Math.min(start + length, otherStart + otherLength) - Math.max(start, otherStart);
}

/**
 * The text runs a field would cover: at least half the line's height and two real characters
 * lie under it. Where a run is wider than the field, the covered characters are found by
 * their share of the run's width, so a field over the blank of "Signature: ______" passes.
 */
export function coveredText(rect: Rect, items: TextItem[]): TextItem[] {
  return items.filter((item) => {
    if (item.width <= 0 || item.height <= 0 || item.str.length === 0) return false;
    const down = overlap(rect.y, rect.height, item.y, item.height);
    if (down < item.height * MIN_HEIGHT_SHARE) return false;
    const perChar = item.width / item.str.length;
    const from = Math.max(0, Math.floor((rect.x - item.x) / perChar));
    const to = Math.min(item.str.length, Math.ceil((rect.x + rect.width - item.x) / perChar));
    if (to <= from) return false;
    const covered = item.str.replace(TAGS, (tag) => ' '.repeat(tag.length)).slice(from, to);
    return covered.replace(NOT_TEXT, '').length >= MIN_CHARACTERS;
  });
}

/**
 * Ids of signature and initials fields that sit over page text. `textOf` returns the text
 * runs of a document's page, or undefined while they are not read yet.
 */
export function fieldsOverText(
  fields: Field[],
  textOf: (documentId: string, page: number) => TextItem[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const field of fields) {
    if (!OVERLAP_CHECKED_TYPES.includes(field.type)) continue;
    const items = textOf(field.documentId, field.page);
    if (items && coveredText(field.rect, items).length > 0) ids.add(field.id);
  }
  return ids;
}
