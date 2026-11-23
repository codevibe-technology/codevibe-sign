'use client';

import { Check, Pause, Play } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Clip, type ClipSpec } from './clip';
import { attachStoryPager } from './story-pager';

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

const WIDE = '(min-width: 1024px)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The step a reading line falls in: the last one whose top has passed it. */
export function stepAt(tops: number[], line: number): number {
  let index = 0;
  tops.forEach((top, i) => {
    if (top <= line) index = i;
  });
  return index;
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
 * "From PDF to sealed copy": the six steps told as the visitor scrolls. The clip stays pinned
 * while the step text moves past it, and each scroll, swipe or key press moves exactly one step,
 * so a quick flick cannot run past them all. Before the first step and after the last the page
 * scrolls as usual. The step list jumps straight to any step.
 *
 * With reduced motion there is no stage and no snapping: the steps sit one under another, each
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
  const stageRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const stage = stageRef.current;
      // A stage that is not laid out (reduced motion hides it) has no step to follow.
      if (!stage || stage.getBoundingClientRect().height === 0) return;
      const wide = window.matchMedia?.(WIDE).matches ?? true;
      // Side by side the steps are read at the middle of the screen; stacked, just under the clip.
      const line = wide ? window.innerHeight / 2 : stage.getBoundingClientRect().bottom + 48;
      const tops = stepRefs.current.map((el) => el?.getBoundingClientRect().top ?? Infinity);
      setIndex(stepAt(tops, line));
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
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION);
    let detach: (() => void) | null = null;
    const update = () => {
      detach?.();
      detach = null;
      if (query?.matches) return;
      detach = attachStoryPager({
        stops: () =>
          stepRefs.current.flatMap((el) =>
            el
              ? [
                  el.getBoundingClientRect().top +
                    window.scrollY -
                    (parseFloat(getComputedStyle(el).scrollMarginTop) || 0),
                ]
              : [],
          ),
      });
    };
    update();
    query?.addEventListener('change', update);
    return () => {
      query?.removeEventListener('change', update);
      detach?.();
    };
  }, []);

  useEffect(() => {
    setLoaded((before) => {
      if (before.has(index) && (index + 1 >= steps.length || before.has(index + 1))) return before;
      const next = new Set(before);
      next.add(index);
      if (index + 1 < steps.length) next.add(index + 1);
      return next;
    });
  }, [index, steps.length]);

  const jump = useCallback((to: number) => {
    const target = stepRefs.current[to];
    if (!target) return;
    const reduced = window.matchMedia?.(REDUCED_MOTION).matches ?? false;
    target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
  }, []);

  const current = steps[index]!;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-story
      className="story relative scroll-mt-16 border-y border-line bg-canvas"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="pt-16 pb-8 sm:pt-20 lg:pointer-events-none lg:absolute lg:top-0 lg:z-20 lg:w-[min(30rem,40%)] lg:pt-12 motion-reduce:lg:pointer-events-auto motion-reduce:lg:static motion-reduce:lg:w-auto">
          <h2 id={`${id}-title`} className="max-w-xl text-3xl font-bold sm:text-4xl">
            {title}
          </h2>
          <p className="mt-3 max-w-xl text-muted">{intro}</p>
        </div>

        <div className="relative flex flex-col lg:flex-row-reverse lg:gap-14">
          <div
            ref={stageRef}
            className="sticky top-16 z-10 -mx-4 flex h-[46svh] flex-col bg-canvas px-4 pt-3 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:h-[calc(100svh-4rem)] lg:flex-1 lg:px-0 lg:pt-8 lg:pb-8 motion-reduce:hidden"
          >
            <ol aria-label="Steps" className="flex gap-1 sm:gap-2">
              {steps.map((step, i) => (
                <li key={step.id} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    aria-current={i === index ? 'step' : undefined}
                    aria-label={`Step ${i + 1}: ${step.name}`}
                    className={cn(
                      'group flex w-full flex-col items-start gap-1.5 pt-1 text-left text-xs font-semibold transition-colors sm:text-sm',
                      i === index ? 'text-ink' : 'text-muted hover:text-ink',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'block h-[3px] w-full rounded-full transition-colors duration-300',
                        i < index ? 'bg-ink/70' : i === index ? 'bg-primary' : 'bg-line-strong',
                      )}
                    />
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
            <div className="relative mt-3 h-[calc(46svh-4.25rem)] [container-type:size] lg:mt-6 lg:h-auto lg:min-h-0 lg:flex-1">
              {steps.map((step, i) => (
                <div
                  key={step.id}
                  aria-hidden={i !== index}
                  className={cn(
                    'absolute inset-0 flex items-center justify-center transition-[opacity,translate] duration-500 ease-out',
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
                        className="absolute right-3 bottom-3 z-10 flex h-9 w-9 items-center justify-center rounded-md bg-[#0D1B2A]/85 text-white shadow-[0_2px_8px_rgb(13_27_42/0.3)] transition-colors hover:bg-[#0D1B2A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
          </div>

          <ol className="lg:w-[min(30rem,40%)] lg:shrink-0 motion-reduce:lg:w-full">
            {steps.map((step, i) => (
              <li
                key={step.id}
                id={step.id}
                ref={(el) => {
                  stepRefs.current[i] = el;
                }}
                className={cn(
                  'story-step flex flex-col py-8 motion-safe:min-h-[calc(54svh-4rem)] motion-safe:scroll-mt-[calc(4rem+46svh)] lg:py-0 lg:motion-safe:min-h-[calc(100svh-4rem)] lg:motion-safe:scroll-mt-16 lg:motion-safe:justify-center motion-reduce:border-t motion-reduce:border-line motion-reduce:lg:grid motion-reduce:lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] motion-reduce:lg:content-start motion-reduce:lg:gap-x-14 motion-reduce:lg:py-16',
                  i === 0 && 'lg:motion-safe:pt-40',
                )}
              >
                <p className="text-sm font-semibold text-primary">
                  Step {i + 1} of {steps.length}
                  <span className="sr-only">: {step.name}</span>
                </p>
                <h3 id={`${step.id}-title`} className="mt-2 text-2xl font-bold sm:text-[1.75rem]">
                  {step.title}
                </h3>
                <p id={`${step.id}-text`} className="mt-3 text-muted sm:text-lg">
                  {step.text}
                </p>
                <ul className="mt-4 space-y-2 text-[15px]">
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
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
