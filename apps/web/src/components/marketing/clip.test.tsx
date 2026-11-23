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

/** The browser gives up on the file it picked, the way Chrome does on a VP9 it cannot decode. */
function failToDecode(video: HTMLVideoElement) {
  const picked = video.querySelector('source')!.src;
  Object.defineProperty(video, 'currentSrc', { value: picked, configurable: true });
  Object.defineProperty(video, 'error', { value: { code: 3 }, configurable: true });
  Object.defineProperty(video, 'paused', { value: true, configurable: true });
  act(() => {
    video.dispatchEvent(new Event('error'));
  });
}

const sourcesOf = (container: HTMLElement) =>
  [...container.querySelectorAll('video source')].map((s) => s.getAttribute('src'));

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
  it('downloads nothing up front and offers H.264 before VP9, with a poster', () => {
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
    expect(
      [...video.querySelectorAll('source')].map((s) => [s.getAttribute('src'), s.type]),
    ).toEqual([
      ['/home/send.mp4', 'video/mp4'],
      ['/home/send.webm', 'video/webm'],
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

  it('driven from outside, plays only while active and draws no button of its own', () => {
    setReducedMotion(false);
    const { container, rerender } = render(<Clip clip={CLIP} active={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(observed).toBeNull();
    rerender(<Clip clip={CLIP} active />);
    scrollTo(true);
    expect(play).toHaveBeenCalledTimes(1);
    rerender(<Clip clip={CLIP} active={false} />);
    expect(pause).toHaveBeenCalled();
    expect(container.querySelector('video')).toHaveAttribute('preload', 'none');
  });

  it('fetches only the metadata of the clip next in line', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} active={false} prefetch />);
    expect(container.querySelector('video')).toHaveAttribute('preload', 'metadata');
    expect(play).not.toHaveBeenCalled();
  });

  it('moves on to the other file when the first one fails to decode, and keeps playing', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} active />);
    scrollTo(true);
    const first = container.querySelector('video')!;
    act(() => {
      first.dispatchEvent(new Event('playing'));
    });
    expect(container.querySelector('img')).toBeNull();
    play.mockClear();

    failToDecode(first);

    const second = container.querySelector('video')!;
    expect(second).not.toBe(first);
    expect(sourcesOf(container)).toEqual(['/home/send.webm']);
    // the poster covers the clip again until the next file really plays
    expect(container.querySelector('img')).toHaveAttribute('src', '/home/send.webp');
    expect(play).toHaveBeenCalled();
    expect(play.mock.contexts.every((video) => video === second)).toBe(true);
    // the new element is watched: it still pauses when scrolled away
    scrollTo(false);
    expect(pause.mock.contexts).toContain(second);
  });

  it('keeps the poster when the last file fails as well, without retrying for ever', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} active />);
    scrollTo(true);
    failToDecode(container.querySelector('video')!);
    const last = container.querySelector('video')!;
    play.mockClear();
    failToDecode(last);
    expect(container.querySelector('video')).toBe(last);
    expect(sourcesOf(container)).toEqual(['/home/send.webm']);
    expect(container.querySelector('img')).toHaveAttribute('src', '/home/send.webp');
    expect(play).not.toHaveBeenCalled();
  });

  it('skips straight to the next file the browser has not tried yet', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} active />);
    scrollTo(true);
    const video = container.querySelector('video')!;
    // a browser without H.264 passes over the MP4 and fails on the WebM: nothing is left
    Object.defineProperty(video, 'currentSrc', {
      value: 'http://localhost/home/send.webm',
      configurable: true,
    });
    Object.defineProperty(video, 'error', { value: { code: 3 }, configurable: true });
    act(() => {
      video.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('video')).toBe(video);
    expect(sourcesOf(container)).toEqual(['/home/send.mp4', '/home/send.webm']);
  });

  it('switches the file of a waiting clip without starting it', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} active={false} prefetch />);
    failToDecode(container.querySelector('video')!);
    expect(sourcesOf(container)).toEqual(['/home/send.webm']);
    expect(container.querySelector('video')).toHaveAttribute('preload', 'metadata');
    expect(play).not.toHaveBeenCalled();
  });

  it('with reduced motion resumes a clip the visitor started on the next file', async () => {
    setReducedMotion(true);
    const { container } = render(<Clip clip={CLIP} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Play the clip: sending a document' }),
    );
    play.mockClear();
    failToDecode(container.querySelector('video')!);
    const next = container.querySelector('video')!;
    expect(sourcesOf(container)).toEqual(['/home/send.webm']);
    expect(play.mock.contexts).toEqual([next]);
  });

  it('ignores an error event that carries no media error', () => {
    setReducedMotion(false);
    const { container } = render(<Clip clip={CLIP} active />);
    const video = container.querySelector('video')!;
    act(() => {
      video.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('video')).toBe(video);
    expect(sourcesOf(container)).toEqual(['/home/send.mp4', '/home/send.webm']);
  });
});
