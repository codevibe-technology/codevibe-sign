import { createHash } from 'node:crypto';

export interface TrailEntry {
  /** The audit action, as the app records it. */
  action: string;
  title: string;
  detail: string;
  /** Local time in IST, for the example. */
  at: string;
  hash: string;
  prev: string | null;
}

const STEPS: Omit<TrailEntry, 'hash' | 'prev'>[] = [
  {
    action: 'envelope.sent',
    title: 'Sent for signature',
    detail: 'To Rohan Mehta at rohan@example.com, with an expiry date and reminders.',
    at: '10:02:14',
  },
  {
    action: 'recipient.viewed',
    title: 'Link opened',
    detail: 'On a phone, from 203.0.113.24. The PDF stays closed for now.',
    at: '10:41:03',
  },
  {
    action: 'recipient.authenticated',
    title: 'One-time code typed',
    detail: 'The code from his email matched, so the document opened.',
    at: '10:41:27',
  },
  {
    action: 'recipient.signed',
    title: 'Signed',
    detail: 'A drawn signature on page 1, with the device and IP address kept.',
    at: '10:42:30',
  },
  {
    action: 'envelope.completed',
    title: 'Sealed',
    detail: 'A PAdES seal and a certificate page. Any later change to the PDF breaks the seal.',
    at: '10:42:31',
  },
];

/**
 * A made-up audit trail for the home page, chained the way the app chains a real one: each
 * entry's SHA-256 covers the entry before it, so the hashes shown are real hashes of the example.
 */
export const SAMPLE_TRAIL: TrailEntry[] = STEPS.reduce<TrailEntry[]>((trail, step) => {
  const prev = trail.at(-1)?.hash ?? null;
  const hash = createHash('sha256')
    .update(`${prev ?? ''}|${step.action}|2026-11-23T${step.at}+05:30`)
    .digest('hex');
  trail.push({ ...step, hash, prev });
  return trail;
}, []);

/** A hash as people read one aloud: the first and last few characters. */
export const shortHash = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-4)}`;
