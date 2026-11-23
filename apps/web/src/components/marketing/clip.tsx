'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
 * A short silent clip of the product. Nothing is downloaded until the clip is on screen; then it
 * plays on a loop, and it pauses again when scrolled away. Visitors who ask for reduced motion see
 * the poster and start it themselves. The button pauses any clip, as moving content must be.
 *
 * The poster is an image over the video rather than the video's own poster, so the browser can
 * load it lazily like any other image.
 */
export function Clip({
  clip,
  describedBy,
  eager = false,
  className,
}: {
  clip: ClipSpec;
  /** The id of the text next to the clip that says what it shows. */
  describedBy?: string;
  /** The clip in the first view: its poster loads at once, ahead of other images. */
  eager?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const pausedByVisitor = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const reduced = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, () => false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React does not write `muted` into the server HTML; browsers only autoplay muted video.
    video.muted = true;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      if (!video.paused) video.pause();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (!pausedByVisitor.current) video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [reduced]);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      pausedByVisitor.current = true;
      video.pause();
    } else {
      pausedByVisitor.current = false;
      video.muted = true;
      video.play().catch(() => {});
    }
  };

  const src = `/home/${clip.name}`;
  return (
    <div className={cn('group relative', className)}>
      <video
        ref={ref}
        className="block h-auto w-full bg-surface-2"
        width={clip.width}
        height={clip.height}
        preload="none"
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPlaying={() => setStarted(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={`${src}.webm`} type="video/webm" />
        <source src={`${src}.mp4`} type="video/mp4" />
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
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? 'Pause' : 'Play'} the clip: ${clip.label}`}
        aria-describedby={describedBy}
        className="absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#0D1B2A]/80 text-white shadow-md backdrop-blur transition-opacity hover:bg-[#0D1B2A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {playing ? (
          <Pause aria-hidden className="h-4 w-4" />
        ) : (
          <Play aria-hidden className="h-4 w-4 translate-x-px" />
        )}
      </button>
    </div>
  );
}
