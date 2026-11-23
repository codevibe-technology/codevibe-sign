// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachStoryPager, keyDirection, nextStop } from './story-pager';

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

describe('attachStoryPager', () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  let now = 0;
  let detach: () => void;

  const wheel = (deltaY: number) => {
    const event = new WheelEvent('wheel', { deltaY, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    scrollTo = vi.fn((options: ScrollToOptions) => {
      Object.defineProperty(window, 'scrollY', { value: options.top, configurable: true });
    });
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    detach = attachStoryPager({ stops: () => STOPS });
  });

  afterEach(() => {
    detach();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('moves exactly one step for a whole flick of wheel events', () => {
    expect(wheel(120)).toBe(true);
    for (let i = 0; i < 20; i++) {
      now += 16;
      expect(wheel(240)).toBe(true);
    }
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: 'smooth' });

    now += 1000;
    expect(wheel(120)).toBe(true);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2600, behavior: 'smooth' });
  });

  it('lets the page scroll on after the last step', () => {
    Object.defineProperty(window, 'scrollY', { value: 2600, configurable: true });
    expect(wheel(120)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('steps with the keyboard too', () => {
    const event = new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: 'smooth' });
  });

  it('moves one step per swipe', () => {
    const touch = (type: string, y: number) => {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, 'touches', {
        value: type === 'touchend' ? [] : [{ clientY: y }],
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    touch('touchstart', 600);
    expect(touch('touchmove', 590)).toBe(true);
    touch('touchmove', 560);
    touch('touchmove', 300);
    touch('touchend', 0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: 'smooth' });
  });

  it('stops listening once detached', () => {
    detach();
    expect(wheel(120)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
