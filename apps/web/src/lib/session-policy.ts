/** Thirty minutes: long enough to read a contract, short enough for a shared desk. */
export const DEFAULT_IDLE_MINUTES = 30;
/** Twelve hours: a working day, so everyone signs in again once a day however busy. */
export const DEFAULT_MAX_HOURS = 12;
export const MAX_IDLE_MINUTES = 24 * 60;
export const MAX_SESSION_HOURS = 30 * 24;

/** How long a person is warned before an idle sign-out. */
const WARNING_SECONDS = 120;
/** The most often a session's activity is written to the database. */
const TOUCH_SECONDS = 60;

export interface SessionPolicy {
  /** Seconds without activity after which a session ends; null when idle sign-out is off. */
  idleSeconds: number | null;
  /** Seconds after signing in when a session ends, however active it is. */
  maxSeconds: number;
  /** The least time between two writes of a session's last activity. */
  touchSeconds: number;
  /** Seconds before an idle sign-out when the browser shows its warning. */
  warningSeconds: number;
}

/**
 * The session rules for `SESSION_IDLE_MINUTES` and `SESSION_MAX_HOURS`. Idle sign-out off (0)
 * leaves only the lifetime cap. The warning and the activity writes shrink with a very short
 * idle limit, so they still fit inside it.
 */
export function sessionPolicy(input: { idleMinutes: number; maxHours: number }): SessionPolicy {
  const maxSeconds = Math.round(input.maxHours * 3600);
  const idle = Math.round(input.idleMinutes * 60);
  const idleSeconds = idle > 0 ? Math.min(idle, maxSeconds) : null;
  return {
    idleSeconds,
    maxSeconds,
    touchSeconds: idleSeconds ? Math.min(TOUCH_SECONDS, Math.floor(idleSeconds / 4)) : 0,
    warningSeconds: idleSeconds ? Math.min(WARNING_SECONDS, Math.floor(idleSeconds / 2)) : 0,
  };
}

export const defaultSessionPolicy = () =>
  sessionPolicy({ idleMinutes: DEFAULT_IDLE_MINUTES, maxHours: DEFAULT_MAX_HOURS });

const plus = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

/**
 * When a session ends if nothing else happens: the idle limit from its last activity, but
 * never later than the lifetime cap from when it was signed in.
 */
export function sessionExpiry(policy: SessionPolicy, createdAt: Date, activeAt: Date): Date {
  const cap = plus(createdAt, policy.maxSeconds);
  if (policy.idleSeconds === null) return cap;
  const idle = plus(activeAt, policy.idleSeconds);
  return idle < cap ? idle : cap;
}

/**
 * Whether a session may still be used. `updatedAt` is its last recorded activity. This holds
 * the rule even for sessions whose stored expiry was set before the limits applied.
 */
export function sessionIsLive(
  policy: SessionPolicy,
  session: { createdAt: Date; updatedAt: Date; expiresAt: Date },
  now: Date,
): boolean {
  if (session.expiresAt <= now) return false;
  return sessionExpiry(policy, session.createdAt, session.updatedAt) > now;
}

/** Whether a request should record the session's activity, or one did so recently enough. */
export function needsTouch(policy: SessionPolicy, updatedAt: Date, now: Date): boolean {
  if (policy.idleSeconds === null) return false;
  return now.getTime() - updatedAt.getTime() >= policy.touchSeconds * 1000;
}
