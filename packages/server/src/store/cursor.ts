import { SignError } from '@codevibe_technology/sign-core';

/** Position after the last envelope of a page: its creation time and id. */
export interface ListCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

export function decodeCursor(value: string): ListCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0]))
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to the validation error below.
  }
  throw new SignError('VALIDATION', 'cursor is not valid', {
    issues: [{ path: 'cursor', message: 'Use the nextCursor of the previous page' }],
  });
}
