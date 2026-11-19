import type { Field, Recipient } from '@codevibe/sign-core';
import type { PdfSource } from '../pdf/types';

/** A fake document of US Letter pages that renders blank canvases. */
export function letterSource(pageCount = 2): PdfSource {
  return {
    pages: Array.from({ length: pageCount }, () => ({ width: 612, height: 792 })),
    renderPage: async (_page, scale) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(612 * scale);
      canvas.height = Math.round(792 * scale);
      return canvas;
    },
  };
}

export function recipient(id: string, name: string, order = 1): Recipient {
  return {
    id,
    name,
    email: `${id}@example.com`,
    role: 'signer',
    order,
    auth: 'email_link',
    status: 'notified',
  };
}

export function field(
  id: string,
  type: Field['type'],
  recipientId: string,
  rect: Partial<Field['rect']> = {},
  extra: Partial<Field> = {},
): Field {
  return {
    id,
    documentId: 'doc',
    recipientId,
    type,
    page: 0,
    rect: { x: 72, y: 72, width: 160, height: 40, ...rect },
    required: true,
    ...extra,
  };
}

/** Base64 of the smallest byte string core accepts as a PNG (signature plus IHDR header). */
export function fakePng(): string {
  const bytes = [
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    13,
    73,
    72,
    68,
    82,
    ...new Array(17).fill(0),
  ];
  return btoa(String.fromCharCode(...bytes));
}
