// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachStoryPager, createWheelGate, keyDirection, nextStop } from './story-pager';

const STOPS = [1000, 1800, 2600];
const REACH = 500;

describe('nextStop', () => {
  it('moves one step at a time inside the story', () => {
    expect(nextStop(STOPS, 1000, 1, REACH)).toBe(1800);
    expect(nextStop(STOPS, 1800, 1, REACH)).toBe(2600);
    expect(nextStop(STOPS, 2600, -1, REACH)).toBe(1800);
    expect(nextStop(STOPS, 1800, -1, REACH)).toBe(1000);
  });

  it('settles on the next step from between two steps', () => {
    expect(nextStop(STOPS, 1300, 1, REACH)).toBe(1800);
    expect(nextStop(STOPS, 1300, -1, REACH)).toBe(1000);
  });

  it('catches the first step when coming in from above, and the last from below', () => {
    expect(nextStop(STOPS, 700, 1, REACH)).toBe(1000);
    expect(nextStop(STOPS, 2900, -1, REACH)).toBe(2600);
  });

  it('leaves the page alone outside the story and past either end', () => {
    expect(nextStop(STOPS, 200, 1, REACH)).toBeNull();
    expect(nextStop(STOPS, 4000, -1, REACH)).toBeNull();
    expect(nextStop(STOPS, 2600, 1, REACH)).toBeNull();
    expect(nextStop(STOPS, 1000, -1, REACH)).toBeNull();
    expect(nextStop(STOPS, 700, -1, REACH)).toBeNull();
    expect(nextStop([], 1000, 1, REACH)).toBeNull();
  });
});

describe('keyDirection', () => {
  const key = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
    Object.defineProperty(event, 'target', { value: target });
    return keyDirection(event);
  };

  it('reads the scrolling keys', () => {
    expect(key('PageDown')).toBe(1);
    expect(key('ArrowDown')).toBe(1);
    expect(key(' ')).toBe(1);
    expect(key(' ', { shiftKey: true })).toBe(-1);
    expect(key('PageUp')).toBe(-1);
    expect(key('ArrowUp')).toBe(-1);
  });

  it('leaves other keys, shortcuts and typing alone', () => {
    expect(key('Home')).toBeNull();
    expect(key('Tab')).toBeNull();
    expect(key('PageDown', { ctrlKey: true })).toBeNull();
    expect(key('ArrowDown', {}, document.createElement('input'))).toBeNull();
    expect(key(' ', {}, document.createElement('button'))).toBeNull();
  });
});

describe('createWheelGate', () => {
  it('lets the first event of a gesture step and holds the rest of it', () => {
    const gate = createWheelGate();
    expect(gate.wheel(0, 4)).toBe('step');
    gate.stepped(0);
    for (let t = 10; t <= 300; t += 10) expect(gate.wheel(t, 4 + (t % 30))).toBe('hold');
  });

  it('holds a long momentum tail past the cool-down', () => {
    const gate = createWheelGate({ cooldownMs: 550 });
    expect(gate.wheel(0, 80)).toBe('step');
    gate.stepped(0);
    let delta = 80;
    for (let t = 16; t < 2000; t += 16) {
      delta = Math.max(1, delta * 0.96);
      expect(gate.wheel(t, delta)).toBe('hold');
    }
  });

  it('takes a new gesture after a quiet gap once the cool-down is over', () => {
    const gate = createWheelGate({ cooldownMs: 550, gapMs: 140 });
    expect(gate.wheel(0, 100)).toBe('step');
    gate.stepped(0);
    expect(gate.wheel(400, 100)).toBe('hold');
    expect(gate.wheel(700, 100)).toBe('step');
  });

  it('takes a second flick that starts while the first one is still fading', () => {
    const gate = createWheelGate({ cooldownMs: 550 });
    expect(gate.wheel(0, 60)).toBe('step');
    gate.stepped(0);
    let t = 0;
    for (const delta of [50, 40, 30, 20, 12, 8, 6, 5, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2]) {
      t += 32;
      expect(gate.wheel(t, delta)).toBe('hold');
    }
    expect(gate.wheel(t + 16, 30)).toBe('step');
  });

  it('starts a new gesture when the direction turns', () => {
    const gate = createWheelGate({ cooldownMs: 100 });
    expect(gate.wheel(0, 40)).toBe('step');
    gate.stepped(0);
    expect(gate.wheel(120, 40)).toBe('hold');
    expect(gate.wheel(130, -40)).toBe('step');
  });

  it('never steps during the cool-down, not even for a new gesture', () => {
    const gate = createWheelGate({ cooldownMs: 550, gapMs: 140 });
    gate.wheel(0, 100);
    gate.stepped(0);
    expect(gate.wheel(300, 100)).toBe('hold');
    expect(gate.cooling(300)).toBe(true);
    expect(gate.cooling(560)).toBe(false);
  });
});

describe('attachStoryPager', () => {
  let move: ReturnType<typeof vi.fn<(top: number, index: number) => void>>;
  let now = 0;
  let detach: () => void;

  const setY = (y: number) =>
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });

  const wheel = (deltaY: number) => {
    const event = new WheelEvent('wheel', { deltaY, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const touch = (type: string, y: number) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'touches', {
      value: type === 'touchend' ? [] : [{ clientY: y }],
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    move = vi.fn<(top: number, index: number) => void>((top) => {
      setY(top);
    });
    setY(1000);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    detach = attachStoryPager({ stops: () => STOPS, move });
  });

  afterEach(() => {
    detach();
    vi.restoreAllMocks();
  });

  it('moves one step at once for a mouse notch', () => {
    expect(wheel(100)).toBe(true);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(1800, 1);
  });

  it('moves exactly one step for a whole trackpad flick, then the next for the next flick', () => {
    for (let i = 0; i < 30; i++) {
      expect(wheel(2 + Math.round(18 * Math.sin((Math.PI * i) / 29)))).toBe(true);
      now += 10;
    }
    expect(move).toHaveBeenCalledTimes(1);
    now += 400;
    expect(wheel(6)).toBe(true);
    expect(move).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenLastCalledWith(2600, 2);
  });

  it('keeps a held gesture from scrolling the page out of the story', () => {
    setY(1800);
    expect(wheel(100)).toBe(true);
    for (let i = 0; i < 50; i++) {
      now += 16;
      expect(wheel(40)).toBe(true);
    }
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('lets a new gesture scroll the page on after the last step, and before the first', () => {
    setY(2600);
    expect(wheel(120)).toBe(false);
    setY(1000);
    now += 1000;
    expect(wheel(-120)).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it('catches the first step when coming in from above', () => {
    setY(700);
    expect(wheel(100)).toBe(true);
    expect(move).toHaveBeenCalledWith(1000, 0);
  });

  it('steps with the keyboard, once per press', () => {
    const press = () => {
      const event = new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press()).toBe(true);
    expect(press()).toBe(true);
    expect(move).toHaveBeenCalledTimes(1);
    now += 600;
    press();
    expect(move).toHaveBeenLastCalledWith(2600, 2);
  });

  it('moves one step per swipe, and the next swipe after the cool-down', () => {
    touch('touchstart', 600);
    expect(touch('touchmove', 592)).toBe(true);
    touch('touchmove', 560);
    touch('touchmove', 300);
    touch('touchend', 0);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(1800, 1);
    now += 600;
    touch('touchstart', 600);
    touch('touchmove', 560);
    touch('touchend', 0);
    expect(move).toHaveBeenLastCalledWith(2600, 2);
  });

  it('leaves a swipe past the last step to the browser', () => {
    setY(2600);
    touch('touchstart', 600);
    expect(touch('touchmove', 560)).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it('stops listening once detached', () => {
    detach();
    expect(wheel(120)).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });
});
