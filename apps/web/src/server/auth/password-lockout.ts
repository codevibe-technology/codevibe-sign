/** Wrong passwords one address may have in a window before password sign-in pauses for it. */
export const MAX_FAILED_SIGN_INS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

interface Failures {
  first: number;
  count: number;
}

export interface PasswordLockout {
  /** Minutes until password sign-in opens again for this address; 0 when it is open. */
  lockedFor(email: string): number;
  /** Counts a wrong password. */
  failed(email: string): void;
  /** Forgets the address, after a correct password or a reset. */
  clear(email: string): void;
}

/**
 * Pauses password sign-in for an address after too many wrong passwords, so a password cannot
 * be guessed at speed from many IP addresses. The emailed link still works while it is paused,
 * so locking someone's password out does not lock them out of their account. Kept in memory,
 * per process, like the other limits.
 */
export function passwordLockout(
  now: () => Date = () => new Date(),
  maxKeys = 50_000,
): PasswordLockout {
  const failures = new Map<string, Failures>();
  const key = (email: string) => email.trim().toLowerCase();

  function current(email: string): Failures | undefined {
    const entry = failures.get(key(email));
    if (entry && now().getTime() - entry.first >= LOCKOUT_WINDOW_MS) {
      failures.delete(key(email));
      return undefined;
    }
    return entry;
  }

  return {
    lockedFor(email) {
      const entry = current(email);
      if (!entry || entry.count < MAX_FAILED_SIGN_INS) return 0;
      return Math.max(1, Math.ceil((entry.first + LOCKOUT_WINDOW_MS - now().getTime()) / 60_000));
    },
    failed(email) {
      const entry = current(email);
      if (entry) {
        entry.count += 1;
        return;
      }
      if (failures.size >= maxKeys) {
        const oldest = failures.keys().next();
        if (!oldest.done) failures.delete(oldest.value);
      }
      failures.set(key(email), { first: now().getTime(), count: 1 });
    },
    clear(email) {
      failures.delete(key(email));
    },
  };
}
