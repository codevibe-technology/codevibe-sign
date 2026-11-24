import type { SignOutReason } from './session-sync';

/** `2:00`, `0:09`: whole seconds left, rounded up so the count never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The sign-in page after an automatic sign-out, coming back to `here` afterwards. */
export function signInAfter(reason: SignOutReason, here: string): string {
  const params = new URLSearchParams(reason === 'chosen' ? {} : { reason });
  if (here.startsWith('/') && !here.startsWith('//')) params.set('next', here);
  return `/sign-in?${params.toString()}`;
}

/** What the sign-in page says to someone sent back to it, by the reason in its address. */
export function signOutNotice(
  reason: string | string[] | undefined,
  idleMinutes: number,
): string | null {
  const value = Array.isArray(reason) ? reason[0] : reason;
  if (value === 'idle') {
    const after =
      idleMinutes > 0
        ? `${idleMinutes} ${idleMinutes === 1 ? 'minute' : 'minutes'} without activity`
        : 'a while without activity';
    return `You were signed out after ${after}, to keep your account safe. Sign in to pick up where you left off.`;
  }
  if (value === 'ended') {
    return 'Your session ended, so you were signed out. Sign in again to carry on.';
  }
  return null;
}
