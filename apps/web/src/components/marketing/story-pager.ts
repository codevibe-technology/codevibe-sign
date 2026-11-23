/**
 * Where one scroll gesture should take the page in the step-by-step story, or null to leave
 * the gesture to the browser.
 *
 * `stops` are the scroll positions at which each step sits in place, in order; `y` is the
 * current position. Coming in from above or below, the nearest step is caught within `reach`
 * of it, so the story always starts on a step. Past the first step going up, or the last
 * going down, the page scrolls on as usual: the story never traps anyone.
 */
export function nextStop(
  stops: number[],
  y: number,
  direction: 1 | -1,
  reach: number,
): number | null {
  if (stops.length === 0) return null;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  const slack = 2;
  if (direction === 1) {
    if (y < first - reach || y >= last - slack) return null;
    return stops.find((stop) => stop > y + slack) ?? null;
  }
  if (y <= first + slack || y > last + reach) return null;
  return [...stops].reverse().find((stop) => stop < y - slack) ?? null;
}

const SCROLL_KEYS: Record<string, 1 | -1> = {
  PageDown: 1,
  ArrowDown: 1,
  ' ': 1,
  PageUp: -1,
  ArrowUp: -1,
};

/** The direction a key scrolls in, or null when the key is not for scrolling here. */
export function keyDirection(event: KeyboardEvent): 1 | -1 | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const direction = SCROLL_KEYS[event.key];
  if (!direction) return null;
  const target = event.target as HTMLElement | null;
  // Keys typed into a field, or Space on a button or link, keep their own meaning.
  if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="slider"]'))
    return null;
  if (event.key === ' ' && target?.closest?.('button, a, summary')) return null;
  if (event.key === ' ' && event.shiftKey) return -1;
  return direction;
}

/**
 * Turns wheel, touch and key input into one step per gesture while the story is in view. A
 * gesture is everything until the input goes quiet for `quietMs`, so the long tail of a
 * trackpad flick cannot carry the page past the next step.
 */
export function attachStoryPager({
  stops,
  quietMs = 220,
  settleMs = 650,
}: {
  /** The scroll positions of the steps, measured now. */
  stops: () => number[];
  quietMs?: number;
  settleMs?: number;
}): () => void {
  let busyUntil = 0;
  let touchStartY: number | null = null;
  let touchHandled = false;

  const go = (direction: 1 | -1): boolean => {
    const target = nextStop(stops(), window.scrollY, direction, window.innerHeight * 0.6);
    if (target === null) return false;
    window.scrollTo({ top: target, behavior: 'smooth' });
    busyUntil = performance.now() + settleMs;
    return true;
  };

  const claims = (direction: 1 | -1) =>
    nextStop(stops(), window.scrollY, direction, window.innerHeight * 0.6) !== null;

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    if (event.deltaY === 0) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    const now = performance.now();
    if (now < busyUntil) {
      // Still the same gesture: hold the page where the last step put it.
      event.preventDefault();
      busyUntil = Math.max(busyUntil, now + quietMs);
      return;
    }
    if (go(direction)) event.preventDefault();
  };

  const onKey = (event: KeyboardEvent) => {
    const direction = keyDirection(event);
    if (!direction) return;
    if (performance.now() < busyUntil && claims(direction)) {
      event.preventDefault();
      return;
    }
    if (go(direction)) event.preventDefault();
  };

  const onTouchStart = (event: TouchEvent) => {
    touchStartY = event.touches.length === 1 ? event.touches[0]!.clientY : null;
    touchHandled = false;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (touchStartY === null || event.touches.length !== 1) return;
    const dy = touchStartY - event.touches[0]!.clientY;
    if (Math.abs(dy) < 8) return;
    const direction = dy > 0 ? 1 : -1;
    if (touchHandled || performance.now() < busyUntil) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (!claims(direction)) {
      touchStartY = null;
      return;
    }
    if (event.cancelable) event.preventDefault();
    if (Math.abs(dy) >= 24) {
      touchHandled = go(direction);
    }
  };

  const onTouchEnd = () => {
    touchStartY = null;
    touchHandled = false;
  };

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
  };
}
