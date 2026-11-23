import type { ClipSpec } from './clip';

/**
 * The product clips on the home page, recorded from the app with made-up people and companies.
 * The files live in `public/home/`; the names are stable, so a new recording replaces them in place.
 */
export const CLIPS = {
  hero: {
    name: 'hero',
    width: 1280,
    height: 800,
    label: 'placing fields, the sealed PDF and a seal check',
  },
  send: {
    name: 'send',
    width: 1280,
    height: 800,
    label: 'sending a document for signature',
  },
  sign: {
    name: 'sign-phone',
    width: 540,
    height: 1168,
    label: 'signing on a phone',
  },
  sealed: {
    name: 'sealed',
    width: 1280,
    height: 800,
    label: 'the sealed PDF and its certificate page',
  },
  audit: {
    name: 'audit',
    width: 1280,
    height: 800,
    label: 'the audit trail of an envelope',
  },
  verify: {
    name: 'verify',
    width: 1280,
    height: 800,
    label: 'checking a signed PDF on the verify page',
  },
  bulk: {
    name: 'bulk',
    width: 1280,
    height: 800,
    label: 'a bulk send from a CSV file',
  },
  api: {
    name: 'api',
    width: 1280,
    height: 800,
    label: 'creating an API key and a webhook endpoint',
  },
} as const satisfies Record<string, ClipSpec>;

export type ClipName = keyof typeof CLIPS;

/** Where a clip's poster image is served. */
export const posterOf = (clip: ClipSpec) => `/home/${clip.name}.webp`;
