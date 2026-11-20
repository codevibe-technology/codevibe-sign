/** The PostgreSQL channel every web process listens on for envelope changes. */
export const LIVE_CHANNEL = 'cvs_envelope_changes';

/** What open pages learn about a change: which envelope, and the audit actions. Nothing else. */
export interface LiveChange {
  workspaceId: string;
  envelopeId: string;
  actions: string[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION = /^[a-z_]+\.[a-z_]+$/;
const MAX_ACTIONS = 20;

const valid = (change: LiveChange) =>
  ID.test(change.workspaceId) &&
  ID.test(change.envelopeId) &&
  change.actions.length <= MAX_ACTIONS &&
  change.actions.every((a) => ACTION.test(a));

/**
 * The NOTIFY payload for a change: ids and action names only, never a name, an email or a
 * title, because every process sees every payload. Null when a value does not look like one.
 */
export function encodeChange(change: LiveChange): string | null {
  const actions = [...new Set(change.actions)];
  const clean = { workspaceId: change.workspaceId, envelopeId: change.envelopeId, actions };
  if (!valid(clean)) return null;
  return JSON.stringify({ w: clean.workspaceId, e: clean.envelopeId, a: clean.actions });
}

export function decodeChange(payload: string): LiveChange | null {
  try {
    const raw = JSON.parse(payload) as { w?: unknown; e?: unknown; a?: unknown };
    if (typeof raw.w !== 'string' || typeof raw.e !== 'string' || !Array.isArray(raw.a)) {
      return null;
    }
    if (!raw.a.every((a): a is string => typeof a === 'string')) return null;
    const change = { workspaceId: raw.w, envelopeId: raw.e, actions: raw.a };
    return valid(change) ? change : null;
  } catch {
    return null;
  }
}
