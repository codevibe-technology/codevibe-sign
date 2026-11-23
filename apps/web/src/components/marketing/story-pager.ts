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

export type WheelVerdict = 'step' | 'hold';

/**
 * Tells one wheel gesture from the next. A mouse notch is one event; a trackpad flick is a
 * burst of small events followed by a long momentum tail. Either way the first event of a
 * gesture may move the story one step, and the rest of that gesture is held. A new gesture
 * starts after a quiet gap, on a change of direction, or when the deltas jump back up in the
 * middle of a fading tail (a second flick before the first one has died away).
 *
 * After a step nothing moves for `cooldownMs`, however hard the wheel is spun, so a fast flick
 * cannot skip a step. The cool-down is fixed: a long momentum tail does not stretch it.
 */
export function createWheelGate({
  gapMs = 140,
  cooldownMs = 550,
}: { gapMs?: number; cooldownMs?: number } = {}) {
  let lastAt = -Infinity;
  let lastDirection = 0;
  let recent: number[] = [];
  let spent = false;
  let lockedUntil = -Infinity;

  return {
    /** Classifies one wheel event: `step` means it may move the story, `hold` that it may not. */
    wheel(time: number, deltaY: number): WheelVerdict {
      const size = Math.abs(deltaY);
      const direction = Math.sign(deltaY);
      const fading = recent.length === 0 ? Infinity : Math.min(...recent);
      const fresh =
        time - lastAt > gapMs || direction !== lastDirection || (size >= 12 && size > fading * 2.5);
      lastAt = time;
      lastDirection = direction;
      recent = fresh ? [size] : [...recent.slice(-2), size];
      if (fresh) spent = false;
      return time < lockedUntil || spent ? 'hold' : 'step';
    },
    /** Records that the event just classified moved the story. */
    stepped(time: number) {
      spent = true;
      lockedUntil = time + cooldownMs;
    },
    /** True while the last step's cool-down runs. */
    cooling(time: number) {
      return time < lockedUntil;
    },
  };
}

export interface StoryPagerOptions {
  /** The scroll positions of the steps, measured now. */
  stops: () => number[];
  /** Moves the page to the step at `index`, whose scroll position is `top`. */
  move: (top: number, index: number) => void;
  cooldownMs?: number;
  gapMs?: number;
}

/**
 * Turns wheel, touch and key input into exactly one step per gesture while the story is on
 * screen: the step moves at once, on the first event of the gesture, and a short cool-down
 * swallows the rest of it. Before the first step and after the last, a new gesture scrolls the
 * page as usual.
 */
export function attachStoryPager({
  stops,
  move,
  cooldownMs = 550,
  gapMs = 140,
}: StoryPagerOptions): () => void {
  const gate = createWheelGate({ cooldownMs, gapMs });
  let touchStartY: number | null = null;
  let touchHandled = false;

  const reach = () => window.innerHeight * 0.6;

  const go = (direction: 1 | -1): boolean => {
    const all = stops();
    const target = nextStop(all, window.scrollY, direction, reach());
    if (target === null) return false;
    move(target, all.indexOf(target));
    return true;
  };

  const claims = (direction: 1 | -1) =>
    nextStop(stops(), window.scrollY, direction, reach()) !== null;

  /** Between the first and the last step, where a held gesture must not leak out. */
  const onStory = () => {
    const all = stops();
    if (all.length === 0) return false;
    const y = window.scrollY;
    return y >= all[0]! - 2 && y <= all[all.length - 1]! + 2;
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    if (event.deltaY === 0) return;
    const now = performance.now();
    if (gate.wheel(now, event.deltaY) === 'step') {
      if (go(event.deltaY > 0 ? 1 : -1)) {
        gate.stepped(now);
        event.preventDefault();
      }
      return;
    }
    if (gate.cooling(now) || onStory()) event.preventDefault();
  };

  const onKey = (event: KeyboardEvent) => {
    const direction = keyDirection(event);
    if (!direction) return;
    const now = performance.now();
    if (gate.cooling(now)) {
      if (claims(direction)) event.preventDefault();
      return;
    }
    if (go(direction)) {
      gate.stepped(now);
      event.preventDefault();
    }
  };

  const onTouchStart = (event: TouchEvent) => {
    touchStartY = event.touches.length === 1 ? event.touches[0]!.clientY : null;
    touchHandled = false;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (touchStartY === null || event.touches.length !== 1) return;
    const dy = touchStartY - event.touches[0]!.clientY;
    if (Math.abs(dy) < 6) return;
    const direction = dy > 0 ? 1 : -1;
    const now = performance.now();
    if (touchHandled || gate.cooling(now)) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (!claims(direction)) {
      touchStartY = null;
      return;
    }
    if (event.cancelable) event.preventDefault();
    if (Math.abs(dy) >= 18 && go(direction)) {
      touchHandled = true;
      gate.stepped(now);
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

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Scrolls the window to `top` over `ms` with an ease-out curve, and returns a function that
 * stops it. Driving the scroll here, rather than with `behavior: 'smooth'`, keeps a step the
 * same length in every browser, so the cool-down can be set to match it.
 */
export function glideTo(top: number, ms = 420): () => void {
  const from = window.scrollY;
  const distance = top - from;
  if (Math.abs(distance) < 1 || ms <= 0) {
    window.scrollTo({ top, behavior: 'instant' });
    return () => {};
  }
  const start = performance.now();
  let frame = requestAnimationFrame(function tick(now) {
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    window.scrollTo({ top: from + distance * easeOut(t), behavior: 'instant' });
    if (t < 1) frame = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(frame);
}
