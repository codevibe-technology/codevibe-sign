'use client';

import { Pause, Play } from 'lucide-react';
import {
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { cn } from '@/lib/cn';

export interface ClipSpec {
  /** File stem under `/home/`: `<name>.webm`, `<name>.mp4` and the poster `<name>.webp`. */
  name: string;
  width: number;
  height: number;
  /** What the clip shows, for the play and pause button. */
  label: string;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToMotion(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION).matches;

/**
 * The files of a clip, in the order the browser should try them. H.264 comes first: every
 * browser that has it decodes it in hardware without trouble, and Safari on an iPhone needs it.
 * VP9 is for browsers without H.264. Chrome on a Mac hands VP9 to the hardware decoder, which
 * can refuse it; Chrome then falls back to software, but not when several clips start at once,
 * and the clip stops with a decode error.
 */
export function clipSources(clip: Pick<ClipSpec, 'name'>) {
  return [
    { src: `/home/${clip.name}.mp4`, type: 'video/mp4' },
    { src: `/home/${clip.name}.webm`, type: 'video/webm' },
  ];
}

/** Starts the clip and notes that it should be playing, so a retry after an error resumes it. */
function start(video: HTMLVideoElement, wanted: RefObject<boolean>) {
  wanted.current = true;
  video.muted = true;
  video.play().catch(() => {});
}

function stop(video: HTMLVideoElement, wanted: RefObject<boolean>) {
  wanted.current = false;
  if (!video.paused) video.pause();
}

/**
 * A short silent clip of the product. Nothing is downloaded until the clip is on screen; then it
 * plays on a loop, and it pauses again when scrolled away. Visitors who ask for reduced motion see
 * the poster and start it themselves. The button pauses any clip, as moving content must be.
 *
 * Given `active`, the clip is driven from outside instead: it plays only while active and on
 * screen, and the owner draws the play and pause button.
 *
 * The poster is an image over the video rather than the video's own poster, so the browser can
 * load it lazily like any other image.
 *
 * A file that fails to play is dropped and the clip starts again from the next one; with none
 * left the poster stays.
 */
export function Clip({
  clip,
  describedBy,
  eager = false,
  active,
  prefetch = false,
  className,
}: {
  clip: ClipSpec;
  /** The id of the text next to the clip that says what it shows. */
  describedBy?: string;
  /** The clip in the first view: its poster loads at once, ahead of other images. */
  eager?: boolean;
  /** Set by an owner that decides when the clip plays; the clip then has no button of its own. */
  active?: boolean;
  /** The next clip in line: fetch its metadata so it starts without a gap. */
  prefetch?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const pausedByVisitor = useRef(false);
  const wanted = useRef(false);
  const resumeAfterError = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [dropped, setDropped] = useState(0);
  const reduced = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, () => false);
  const all = clipSources(clip);
  const sources = all.slice(dropped);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React does not write `muted` into the server HTML; browsers only autoplay muted video.
    video.muted = true;
    if (reduced || active === false || typeof IntersectionObserver === 'undefined') {
      stop(video, wanted);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (active || !pausedByVisitor.current) start(video, wanted);
        } else {
          stop(video, wanted);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [reduced, active, dropped]);

  useEffect(() => {
    const video = ref.current;
    if (!video || dropped === 0 || !resumeAfterError.current) return;
    resumeAfterError.current = false;
    start(video, wanted);
  }, [dropped]);

  const onError = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!video.error) return;
    const failed = sources.findIndex((source) => video.currentSrc.endsWith(source.src));
    const next = dropped + Math.max(failed, 0) + 1;
    resumeAfterError.current = wanted.current;
    setPlaying(false);
    setStarted(false);
    if (next < all.length) setDropped(next);
  };

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      pausedByVisitor.current = true;
      stop(video, wanted);
    } else {
      pausedByVisitor.current = false;
      start(video, wanted);
    }
  };

  const src = `/home/${clip.name}`;
  return (
    <div className={cn('group relative', className)}>
      <video
        // A fresh element for the next file: a failed one keeps its error after its sources change.
        key={dropped}
        ref={ref}
        className="block h-auto w-full bg-surface-2"
        width={clip.width}
        height={clip.height}
        preload={prefetch ? 'metadata' : 'none'}
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPlaying={() => setStarted(true)}
        onPause={() => setPlaying(false)}
        onError={onError}
      >
        {sources.map((source) => (
          <source key={source.src} src={source.src} type={source.type} />
        ))}
      </video>
      {started ? null : (
        <img
          src={`${src}.webp`}
          alt=""
          width={clip.width}
          height={clip.height}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {active === undefined ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? 'Pause' : 'Play'} the clip: ${clip.label}`}
          aria-describedby={describedBy}
          className="absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-md bg-[#0D1B2A]/85 text-white shadow-[0_2px_8px_rgb(13_27_42/0.3)] transition-colors hover:bg-[#0D1B2A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {playing ? (
            <Pause aria-hidden className="h-4 w-4" />
          ) : (
            <Play aria-hidden className="h-4 w-4 translate-x-px" />
          )}
        </button>
      ) : null}
    </div>
  );
}
