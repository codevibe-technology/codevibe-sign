'use client';

import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { BrandMark } from '@/components/shell/brand-mark';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  SHEET_BELOW,
  pickTarget,
  placeCard,
  stepCounter,
  type Box,
  type TourStep,
} from '@/lib/tours';

/** How long a step waits for its element (a page still loading) before going on without it. */
const WAIT_MS = 2500;
const PAD = 6;

export interface TourRunnerProps {
  steps: readonly TourStep[];
  /** The step on screen; null while the tour waits for the person to move on. */
  index: number | null;
  canGoBack: boolean;
  isLast: boolean;
  /** Past this step the tour waits for the next flow step rather than ending. */
  pausesAfter: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  /** A step whose element is not on screen and that may be left out. */
  onMissing: () => void;
  /** Said to screen readers while the tour waits. */
  waitingNote?: string;
  /** Into `document.body`; otherwise in place, inside a flow that makes the rest inert. */
  portal?: boolean;
  /** Room kept free along the bottom of a phone screen, for a flow's own action bar. */
  sheetBottom?: number;
}

const isOnScreen = (el: Element) => {
  if (el.closest('[inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
};

const findAll = (selector: string) => Array.from(document.querySelectorAll(selector));

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);

/** Elements that handle Escape themselves; the tour leaves the key to them. */
const OWN_ESCAPE = '[role="menu"], [role="listbox"], [role="dialog"]:not([data-tour-card])';
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The tour on screen: a soft spotlight on the step's element and a card beside it (a sheet on
 * phones). Nothing blocks the page: the dimmed area lets clicks through, Escape or Close ends
 * the tour, and focus goes back where it was.
 */
export function TourRunner({
  steps,
  index,
  canGoBack,
  isLast,
  pausesAfter,
  onNext,
  onBack,
  onClose,
  onMissing,
  waitingNote = 'The tour continues on the next step.',
  portal = false,
  sheetBottom = 0,
}: TourRunnerProps) {
  const id = useId();
  const step = index === null ? null : steps[index];
  const card = useRef<HTMLDivElement>(null);
  const before = useRef<Element | null>(null);
  const lastTarget = useRef<Element | null>(null);
  const [target, setTarget] = useState<Element | null>(null);
  // The step drawn on screen. It lags `index` while the next step's element is looked up, so
  // the card and spotlight move once, to the right place.
  const [shownIndex, setShownIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [mounted, setMounted] = useState(false);
  const missing = useRef(onMissing);
  missing.current = onMissing;

  useEffect(() => {
    setMounted(true);
    before.current = document.activeElement;
    return () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      const back = before.current;
      if (lost && back instanceof HTMLElement && back.isConnected) {
        back.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    if (!step || index === null) {
      setShownIndex(null);
      setTarget(null);
      setBox(null);
      return;
    }
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const found = pickTarget(step.targets, findAll, isOnScreen);
      if (found) {
        const r = found.getBoundingClientRect();
        if (
          r.top < 0 ||
          r.bottom > window.innerHeight ||
          r.left < 0 ||
          r.right > window.innerWidth
        ) {
          found.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          });
        }
        lastTarget.current = found;
        setTarget(found);
        setBox(boxOf(found));
        setShownIndex(index);
      } else if (step.targets.length === 0 || Date.now() - started > WAIT_MS) {
        if (step.optional && step.targets.length > 0) {
          missing.current();
        } else {
          setTarget(null);
          setBox(null);
          setShownIndex(index);
        }
      } else {
        timer = setTimeout(look, 100);
      }
    };
    look();
    return () => clearTimeout(timer);
  }, [step, index]);

  useEffect(() => {
    const measure = () => {
      setViewport((v) =>
        v.width === window.innerWidth && v.height === window.innerHeight
          ? v
          : { width: window.innerWidth, height: window.innerHeight },
      );
      if (target) {
        const next = target.isConnected ? boxOf(target) : null;
        setBox((prev) => (sameBox(prev, next) ? prev : next));
      }
    };
    measure();
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    // Pages and images still settling move the element without any scroll or resize.
    const settle = setInterval(measure, 400);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', soon, true);
      clearInterval(settle);
    };
  }, [target]);

  const shownStep = shownIndex === null ? null : (steps[shownIndex] ?? null);
  const settling = shownIndex !== index;

  useLayoutEffect(() => {
    if (!shownStep || !card.current) return;
    const r = card.current.getBoundingClientRect();
    setSize((prev) =>
      prev && prev.width === r.width && prev.height === r.height
        ? prev
        : { width: r.width, height: r.height },
    );
  });

  useEffect(() => {
    if (shownIndex !== null) {
      card.current
        ?.querySelector<HTMLButtonElement>('[data-tour-primary]')
        ?.focus({ preventScroll: true });
      return;
    }
    // The card went away while the tour waits: focus moves to what it last pointed at.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const last = lastTarget.current;
    if (last instanceof HTMLElement && last.isConnected && last.matches(FOCUSABLE)) {
      last.focus({ preventScroll: true });
    }
  }, [shownIndex]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (shownIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      const from = event.target instanceof Element ? event.target : null;
      const inCard = !!from && !!card.current?.contains(from);
      if (event.key === 'Escape') {
        if (from && !inCard && from.closest(OWN_ESCAPE)) return;
        event.preventDefault();
        close();
      } else if (inCard && !settling && event.key === 'ArrowRight') {
        event.preventDefault();
        onNext();
      } else if (inCard && !settling && event.key === 'ArrowLeft' && canGoBack) {
        event.preventDefault();
        onBack();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shownIndex, settling, close, onNext, onBack, canGoBack]);

  if (!mounted) return null;

  const total = steps.length;
  const counter = shownIndex === null ? '' : stepCounter(shownIndex, total);
  const announcement = shownStep
    ? `Step ${counter}. ${shownStep.title}. ${shownStep.body}`
    : index === null
      ? waitingNote
      : '';

  const placement =
    shownStep && size && viewport.width > 0
      ? placeCard(box, size, viewport, shownStep.side)
      : viewport.width > 0 && viewport.width < SHEET_BELOW
        ? ({ mode: 'sheet', edge: 'bottom' } as const)
        : null;
  const usedFallback =
    !!shownStep &&
    !!target &&
    shownStep.targets.length > 1 &&
    !target.matches(shownStep.targets[0]!);

  let cardStyle: CSSProperties = {};
  if (placement?.mode === 'float') cardStyle = { top: placement.top, left: placement.left };
  else if (placement?.mode === 'sheet') {
    cardStyle =
      placement.edge === 'bottom'
        ? { bottom: `calc(${12 + sheetBottom}px + env(safe-area-inset-bottom))` }
        : { top: 'calc(12px + env(safe-area-inset-top))' };
  }
  const placed = shownStep !== null && size !== null && placement !== null;

  const ui = (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {shownStep ? (
        <>
          {box ? (
            <div
              aria-hidden
              data-tour-spotlight
              className="pointer-events-none fixed z-[60] rounded-xl transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none"
              style={{
                top: box.top - PAD,
                left: box.left - PAD,
                width: box.width + PAD * 2,
                height: box.height + PAD * 2,
                boxShadow:
                  '0 0 0 2px var(--primary), 0 0 0 6px rgb(27 106 224 / 0.18), 0 0 0 200vmax rgb(13 27 42 / 0.42)',
              }}
            />
          ) : (
            <div
              aria-hidden
              data-tour-spotlight
              className="pointer-events-none fixed inset-0 z-[60] bg-[rgb(13_27_42/0.42)]"
            />
          )}
          <div
            ref={card}
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-body`}
            data-tour-card
            data-tour-step={shownStep.id}
            aria-busy={settling || undefined}
            className={cn(
              'fixed z-[61] overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-[0_24px_60px_-16px_rgb(13_27_42/0.45),0_2px_6px_rgb(13_27_42/0.08)]',
              'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
              placement?.mode === 'sheet' ? 'inset-x-3' : 'w-[360px] max-w-[calc(100vw-24px)]',
              placed ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0',
            )}
            style={cardStyle}
          >
            <span
              aria-hidden
              className="block h-1 w-full bg-gradient-to-r from-primary via-primary to-accent"
            />
            <div className="px-5 pt-4 pb-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
                  {counter}
                </p>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close the tour"
                  className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </div>
              {shownStep.mark ? <BrandMark className="mt-1 mb-3 h-10 w-10" /> : null}
              <h2
                id={`${id}-title`}
                className="mt-1 font-display text-[17px] leading-snug font-bold tracking-tight text-ink"
              >
                {shownStep.title}
              </h2>
              <p id={`${id}-body`} className="mt-1.5 text-[14px] leading-relaxed text-muted">
                {shownStep.body}
                {usedFallback && shownStep.fallbackNote ? ` ${shownStep.fallbackNote}` : ''}
              </p>
              <div aria-hidden className="mt-4 flex gap-1">
                {steps.map((s, i) => (
                  <span
                    key={s.id}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors motion-reduce:transition-none',
                      i <= shownIndex! ? 'bg-primary' : 'bg-line',
                    )}
                  />
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                {isLast ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-full px-1 py-1 text-[13px] font-semibold text-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                  >
                    Skip tour
                  </button>
                )}
                <div className="flex items-center gap-2">
                  {canGoBack ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      pill
                      onClick={() => !settling && onBack()}
                      aria-disabled={settling || undefined}
                    >
                      <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                      Back
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    pill
                    onClick={() => !settling && onNext()}
                    aria-disabled={settling || undefined}
                    data-tour-primary
                    className="min-w-[88px]"
                  >
                    {isLast ? (
                      <>
                        <Check aria-hidden className="h-3.5 w-3.5" />
                        Done
                      </>
                    ) : pausesAfter ? (
                      'Got it'
                    ) : (
                      <>
                        Next
                        <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );

  return portal ? createPortal(ui, document.body) : ui;
}
