'use client';

import { Check, Pause, Play } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { cn } from '@/lib/cn';
import { Clip, type ClipSpec } from './clip';
import { attachStoryPager, glideTo } from './story-pager';

export interface StoryStep {
  id: string;
  /** One word for the step list: Send, Sign, Seal. */
  name: string;
  title: string;
  text: string;
  points: string[];
  clip: ClipSpec;
  /** A phone recording, drawn in a phone instead of on a sheet. */
  phone?: boolean;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const GLIDE_MS = 420;

function subscribeToMotion(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION).matches;

/**
 * The step on screen at scroll position `y`: the stage is pinned from `first` on, and each
 * step holds it for `step` pixels of scrolling.
 */
export function stepAt(y: number, first: number, step: number, count: number): number {
  if (count <= 1 || step <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((y - first) / step)));
}

/** The clip on its sheet of paper, or in a phone, sized to the stage it sits in. */
function Frame({
  step,
  children,
  staged,
}: {
  step: StoryStep;
  children: ReactNode;
  staged: boolean;
}) {
  if (step.phone) {
    return (
      <div
        className={cn(
          'rounded-[1.6rem] bg-[#0D1B2A] p-[7px] shadow-[0_18px_40px_-18px_rgb(13_27_42/0.55)]',
          staged
            ? 'w-[min(100cqw,calc((100cqh_-_14px)_*_0.4623_+_14px))]'
            : 'mx-auto w-full max-w-[240px]',
        )}
      >
        <div className="overflow-hidden rounded-[1.25rem]">{children}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[3px] bg-surface ring-1 ring-line shadow-[0_1px_0_rgb(13_27_42/0.04),0_18px_40px_-22px_rgb(13_27_42/0.4)]',
        staged && 'w-[min(100cqw,calc(100cqh*1.6))]',
      )}
    >
      {children}
    </div>
  );
}

/**
 * "From PDF to sealed copy": the six steps on one pinned stage. Once the stage reaches the top
 * of the screen, each wheel notch, trackpad flick, swipe or key press moves exactly one step,
 * at once: the text and the clip cross-fade to the next step and the page glides one step on.
 * Before the first step and after the last the page scrolls as usual. The step list jumps
 * straight to any step.
 *
 * With reduced motion there is no stage and no paging: the steps sit one under another, each
 * with its own still poster and a button to play it.
 */
export function ScrollStory({
  id,
  title,
  intro,
  steps,
}: {
  id: string;
  title: string;
  intro: string;
  steps: StoryStep[];
}) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [held, setHeld] = useState(false);
  const reduced = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, () => false);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const settledAt = useRef(0);
  const stopGlide = useRef<() => void>(() => {});

  /** The scroll position of each step, or none while the stage is not pinned (reduced motion). */
  const stops = useCallback((): number[] => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage || getComputedStyle(stage).position !== 'sticky') return [];
    const pinAt = parseFloat(getComputedStyle(stage).top) || 0;
    const first = track.getBoundingClientRect().top + window.scrollY - pinAt;
    const run = track.offsetHeight - stage.offsetHeight;
    const step = steps.length > 1 ? run / (steps.length - 1) : 0;
    return steps.map((_, i) => Math.round(first + i * step));
  }, [steps]);

  const move = useCallback((top: number, to: number) => {
    setIndex(to);
    // The scroll position catches up while the page glides; until then the target step shows.
    settledAt.current = performance.now() + GLIDE_MS + 60;
    stopGlide.current();
    stopGlide.current = glideTo(top, GLIDE_MS);
  }, []);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (performance.now() < settledAt.current) return;
      const all = stops();
      if (all.length < 2) return;
      setIndex(stepAt(window.scrollY, all[0]!, all[1]! - all[0]!, all.length));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stops]);

  useEffect(() => {
    if (reduced) return;
    const detach = attachStoryPager({ stops, move });
    return () => {
      detach();
      stopGlide.current();
    };
  }, [reduced, stops, move]);

  useEffect(() => {
    setLoaded((before) => {
      if (before.has(index) && (index + 1 >= steps.length || before.has(index + 1))) return before;
      const next = new Set(before);
      next.add(index);
      if (index + 1 < steps.length) next.add(index + 1);
      return next;
    });
  }, [index, steps.length]);

  const jump = useCallback(
    (to: number) => {
      const top = stops()[to];
      if (top === undefined) return;
      move(top, to);
    },
    [stops, move],
  );

  const current = steps[index]!;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-story
      className="story relative scroll-mt-16 border-y border-line bg-canvas"
      style={{ '--story-steps': steps.length } as CSSProperties}
    >
      <div ref={trackRef} className="story-track">
        <div
          ref={stageRef}
          className="story-stage sticky top-16 flex h-[calc(100svh-4rem)] flex-col overflow-hidden motion-reduce:static motion-reduce:h-auto motion-reduce:overflow-visible"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pt-6 pb-4 sm:px-6 lg:pt-10 lg:pb-8 motion-reduce:pt-16 motion-reduce:sm:pt-20">
            <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2">
              <div>
                <h2 id={`${id}-title`} className="max-w-xl text-2xl font-bold sm:text-4xl">
                  {title}
                </h2>
                <p className="mt-2 hidden max-w-xl text-muted sm:block motion-reduce:block">
                  {intro}
                </p>
              </div>
            </div>

            <ol
              aria-label="Steps"
              className="mt-4 flex gap-1 sm:mt-6 sm:gap-2 motion-reduce:hidden"
            >
              {steps.map((step, i) => (
                <li key={step.id} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    aria-current={i === index ? 'step' : undefined}
                    aria-label={`Step ${i + 1}: ${step.name}`}
                    className={cn(
                      'group flex w-full flex-col items-start gap-1.5 rounded-sm pt-1 text-left text-xs font-semibold transition-colors duration-200 ease-out sm:text-sm',
                      i === index ? 'text-ink' : 'text-muted hover:text-ink',
                    )}
                  >
                    <span
                      aria-hidden
                      className="block h-[3px] w-full overflow-hidden rounded-full bg-line-strong"
                    >
                      <span
                        className={cn(
                          'block h-full w-full origin-left rounded-full transition-[scale,background-color] duration-300 ease-out',
                          i < index
                            ? 'scale-x-100 bg-ink/70'
                            : i === index
                              ? 'scale-x-100 bg-primary'
                              : 'scale-x-0 bg-primary',
                        )}
                      />
                    </span>
                    <span className="flex items-baseline gap-1.5 truncate">
                      <span className="font-mono text-[11px] font-medium tabular-nums opacity-70">
                        {i + 1}
                      </span>
                      <span className="truncate">{step.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 sm:mt-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 motion-reduce:block motion-reduce:lg:block">
              <div className="relative min-h-0 flex-1 [container-type:size] lg:order-2 lg:h-full motion-reduce:hidden">
                {steps.map((step, i) => (
                  <div
                    key={step.id}
                    aria-hidden={i !== index}
                    className={cn(
                      'absolute inset-0 flex items-center justify-center transition-[opacity,translate,visibility] duration-300 ease-out',
                      i === index ? 'visible translate-y-0 opacity-100' : 'invisible opacity-0',
                      i < index && '-translate-y-3',
                      i > index && 'translate-y-3',
                    )}
                  >
                    <div className="relative">
                      <Frame step={step} staged>
                        {loaded.has(i) ? (
                          <Clip
                            clip={step.clip}
                            active={i === index && !held}
                            prefetch={i === index + 1}
                          />
                        ) : (
                          <div
                            className={cn(
                              'bg-surface-2',
                              step.phone ? 'aspect-[540/1168]' : 'aspect-[16/10]',
                            )}
                          />
                        )}
                      </Frame>
                      {i === index ? (
                        <button
                          type="button"
                          onClick={() => setHeld((h) => !h)}
                          aria-label={`${held ? 'Play' : 'Pause'} the clip: ${current.clip.label}`}
                          aria-describedby={`${current.id}-text`}
                          className="absolute right-3 bottom-3 z-10 flex h-9 w-9 items-center justify-center rounded-md bg-[#0D1B2A]/85 text-white shadow-[0_2px_8px_rgb(13_27_42/0.3)] transition-colors duration-200 hover:bg-[#0D1B2A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {held ? (
                            <Play aria-hidden className="h-4 w-4 translate-x-px" />
                          ) : (
                            <Pause aria-hidden className="h-4 w-4" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <ol className="grid shrink-0 lg:order-1 lg:content-center motion-reduce:block">
                {steps.map((step, i) => {
                  const hidden = !reduced && i !== index;
                  return (
                    <li
                      key={step.id}
                      id={step.id}
                      aria-hidden={hidden || undefined}
                      className={cn(
                        'story-step col-start-1 row-start-1 transition-[opacity,translate,visibility] duration-300 ease-out motion-reduce:border-t motion-reduce:border-line motion-reduce:py-10 motion-reduce:lg:grid motion-reduce:lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] motion-reduce:lg:grid-rows-[auto_auto_auto_1fr] motion-reduce:lg:content-start motion-reduce:lg:gap-x-14 motion-reduce:lg:py-16',
                        hidden ? 'invisible opacity-0' : 'visible opacity-100',
                        !reduced && i < index && '-translate-y-2',
                        !reduced && i > index && 'translate-y-2',
                      )}
                    >
                      <p className="text-sm font-semibold text-primary">
                        Step {i + 1} of {steps.length}
                        <span className="sr-only">: {step.name}</span>
                      </p>
                      <h3
                        id={`${step.id}-title`}
                        className="mt-1.5 text-xl font-bold sm:text-[1.75rem] lg:mt-2"
                      >
                        {step.title}
                      </h3>
                      <p id={`${step.id}-text`} className="mt-2 text-muted sm:mt-3 sm:text-lg">
                        {step.text}
                      </p>
                      <ul className="mt-3 space-y-1.5 text-[15px] sm:mt-4 sm:space-y-2 motion-safe:max-lg:[@media(max-height:760px)]:hidden">
                        {step.points.map((point) => (
                          <li key={point} className="flex gap-2.5">
                            <Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-success" />
                            {point}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-6 hidden motion-reduce:block lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:mt-0">
                        <Frame step={step} staged={false}>
                          <Clip clip={step.clip} describedBy={`${step.id}-text`} />
                        </Frame>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
