// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Clip } from './clip';

const CLIP = { name: 'send', width: 1280, height: 800, label: 'sending a document' };

let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
let play: Mock<(this: HTMLMediaElement) => Promise<void>>;
let pause: Mock<(this: HTMLMediaElement) => void>;

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const scrollTo = (isIntersecting: boolean) => act(() => observed?.([{ isIntersecting }]));

beforeEach(() => {
  observed = null;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {
        observed = null;
      }
    },
  );
  // jsdom has no media playback: track `paused` the way a browser would.
  play = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pause = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true });
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Clip', () => {
  it('downloads nothing up front and offers both formats with a poster', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} />);
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('preload', 'none');
    const poster = container.querySelector('img')!;
    expect(poster).toHaveAttribute('src', '/home/send.webp');
    expect(poster).toHaveAttribute('loading', 'lazy');
    expect(poster).toHaveAttribute('alt', '');
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('width', '1280');
    expect(video).toHaveAttribute('height', '800');
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect([...video.querySelectorAll('source')].map((s) => s.getAttribute('src'))).toEqual([
      '/home/send.webm',
      '/home/send.mp4',
    ]);
    expect(play).not.toHaveBeenCalled();
  });

  it('loads the poster of the first clip at once', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} eager />);
    expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
    expect(container.querySelector('img')).toHaveAttribute('fetchpriority', 'high');
  });

  it('drops the poster once the clip is really playing', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} />);
    scrollTo(true);
    expect(container.querySelector('img')).not.toBeNull();
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('playing'));
    });
    expect(container.querySelector('img')).toBeNull();
  });

  it('plays while on screen and pauses when scrolled away', async () => {
    setReducedMotion(false);
    render(<Clip clip={CLIP} />);
    scrollTo(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole('button', { name: 'Pause the clip: sending a document' }),
    ).toBeInTheDocument();
    scrollTo(false);
    expect(pause).toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'Play the clip: sending a document' }),
    ).toBeInTheDocument();
  });

  it('stays paused once the visitor pauses it, even when it comes back on screen', async () => {
    setReducedMotion(false);
    render(<Clip clip={CLIP} />);
    scrollTo(true);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Pause the clip: sending a document' }),
    );
    scrollTo(false);
    scrollTo(true);
    expect(play).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole('button', { name: 'Play the clip: sending a document' }),
    );
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('with reduced motion shows the poster and never starts on its own', async () => {
    setReducedMotion(true);
    const { container } = render(<Clip clip={CLIP} />);
    expect(observed).toBeNull();
    scrollTo(true);
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toHaveAttribute('src', '/home/send.webp');
    const button = screen.getByRole('button', { name: 'Play the clip: sending a document' });
    await userEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
