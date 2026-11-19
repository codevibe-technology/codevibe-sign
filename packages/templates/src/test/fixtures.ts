import { SignError, webCryptoHasher, type Clock, type IdGenerator } from '@codevibe/sign-core';
import type { Template } from '../types';

export const T0 = '2026-03-01T10:00:00.000Z';
export const SHA = 'b'.repeat(64);
const A4 = { width: 595, height: 842 };

export function clockAt(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export function counterIds(prefix = 'id'): IdGenerator {
  let n = 0;
  return { id: () => `${prefix}${++n}` };
}

export const deps = (iso = T0) => ({
  clock: clockAt(iso),
  ids: counterIds(),
  hasher: webCryptoHasher,
});

/** Employee signs, then HR countersigns. */
export function offerTemplate(): Template {
  return {
    id: 'offer-letter',
    title: 'Offer letter',
    message: 'Please review and sign your offer.',
    expiresInDays: 14,
    documents: [
      { name: 'offer.pdf', fileKey: 'templates/offer.pdf', sha256: SHA, pageSizes: [A4, A4] },
    ],
    roles: [
      {
        name: 'Employee',
        fields: [
          {
            document: 'templates/offer.pdf',
            type: 'text',
            page: 0,
            rect: { x: 72, y: 120, width: 160, height: 20 },
            label: 'Employee code',
            readOnly: true,
          },
          {
            document: 'templates/offer.pdf',
            type: 'text',
            page: 0,
            rect: { x: 72, y: 160, width: 160, height: 20 },
            label: 'Joining date',
          },
          {
            document: 'templates/offer.pdf',
            type: 'signature',
            page: 1,
            rect: { x: 72, y: 640, width: 180, height: 48 },
          },
        ],
      },
      {
        name: 'HR',
        auth: 'email_otp',
        fields: [
          {
            document: 'templates/offer.pdf',
            type: 'signature',
            page: 1,
            rect: { x: 340, y: 640, width: 180, height: 48 },
          },
        ],
      },
    ],
  };
}

export const people = {
  Employee: { name: 'Asha Rao', email: 'asha@example.com' },
  HR: { name: 'Meera Iyer', email: 'hr@example.com' },
};

export function issuePaths(error: unknown): string[] {
  if (error instanceof SignError && error.code === 'VALIDATION') {
    return (error.details?.issues as { path: string }[]).map((i) => i.path);
  }
  throw error;
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}
