import type { Field, FieldType, Rect } from '@codevibe_technology/sign-core';
import { clampRect, roundRect, type PageSize } from '../geometry';
import type { TextItem } from '../pdf/types';
import { defaultFieldSizes, type Size } from './placement';

/** A text tag found on a page, `{{signature:1}}`, with where its text sits. */
export interface FieldTag {
  page: number;
  type: FieldType;
  /** The recipient's place in the signing order, from 1. */
  recipient: number;
  /** The tag's text box in page points, top-left origin. */
  rect: Rect;
}

const TAG = /\{\{\s*(signature|initials|date|name|text|checkbox)\s*:\s*(\d{1,3})\s*\}\}/gi;

const TYPES: Record<string, FieldType> = {
  signature: 'signature',
  initials: 'initials',
  date: 'date_signed',
  name: 'name',
  text: 'text',
  checkbox: 'checkbox',
};

/**
 * Finds `{{type:n}}` tags in a page's text. A tag inside a longer run of text is located by
 * its share of the characters, which is close enough to cover it with a field.
 */
export function findTags(items: TextItem[], page: number): FieldTag[] {
  const tags: FieldTag[] = [];
  for (const item of items) {
    if (!item.str.includes('{{')) continue;
    const perChar = item.str.length > 0 ? item.width / item.str.length : 0;
    for (const match of item.str.matchAll(TAG)) {
      const type = TYPES[match[1]!.toLowerCase()];
      const recipient = Number(match[2]);
      if (!type || recipient < 1) continue;
      tags.push({
        page,
        type,
        recipient,
        rect: {
          x: item.x + perChar * (match.index ?? 0),
          y: item.y,
          width: perChar * match[0].length,
          height: item.height,
        },
      });
    }
  }
  return tags;
}

export interface TagFieldsInput {
  documentId: string;
  /** Signers and approvers in signing order; tag number n is the nth of them. */
  recipients: { id: string }[];
  pageSizes: PageSize[];
  createId: () => string;
  sizes?: Partial<Record<FieldType, Size>>;
}

/**
 * Fields over the tags: each starts at the tag's left edge, centred on its line, in the
 * type's usual size. Tags for a recipient number nobody has are returned in `unmatched`.
 */
export function fieldsFromTags(
  tags: FieldTag[],
  input: TagFieldsInput,
): { fields: Field[]; unmatched: FieldTag[] } {
  const fields: Field[] = [];
  const unmatched: FieldTag[] = [];
  for (const tag of tags) {
    const recipient = input.recipients[tag.recipient - 1];
    const page = input.pageSizes[tag.page];
    if (!recipient || !page) {
      unmatched.push(tag);
      continue;
    }
    const size = input.sizes?.[tag.type] ?? defaultFieldSizes[tag.type];
    const rect = clampRect(
      {
        x: tag.rect.x,
        y: tag.rect.y + tag.rect.height / 2 - size.height / 2,
        width: size.width,
        height: size.height,
      },
      page,
    );
    fields.push({
      id: input.createId(),
      documentId: input.documentId,
      recipientId: recipient.id,
      type: tag.type,
      page: tag.page,
      rect: roundRect(rect),
      required: tag.type !== 'checkbox',
    });
  }
  return { fields, unmatched };
}
