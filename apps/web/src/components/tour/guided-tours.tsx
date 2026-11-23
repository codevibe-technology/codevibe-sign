'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StepKey } from '@/lib/send-flow';
import {
  SEND_TOUR,
  WORKSPACE_TOUR,
  canGoBack,
  enterChapter,
  isLastStep,
  nextStep,
  previousStep,
  startTour,
  type TourDefinition,
  type TourProgress,
} from '@/lib/tours';
import { useTours } from './tour-provider';
import { TourRunner } from './tour-runner';

/** A beat after the page appears, so the tour does not arrive with the first paint. */
const START_DELAY_MS = 450;

/** The phone action bar of the send flow, which the tour sheet stays above. */
const SEND_BAR_PX = 66;

/** Moving through one tour: next, back, close, and leaving out a step with nothing to show. */
function useTourControls(
  tour: TourDefinition,
  progress: TourProgress | null,
  setProgress: (p: TourProgress | null) => void,
) {
  const tours = useTours();
  const direction = useRef<'next' | 'back'>('next');
  const steps = tour.steps;

  const finish = useCallback(
    (status: 'done' | 'skipped') => {
      setProgress(null);
      tours?.end(tour.id, status);
    },
    [setProgress, tours, tour.id],
  );

  const forward = useCallback(() => {
    if (!progress) return;
    direction.current = 'next';
    const next = nextStep(steps, progress);
    if (next.finished) finish('done');
    else setProgress(next);
  }, [progress, steps, finish, setProgress]);

  const backward = useCallback(() => {
    if (!progress) return;
    direction.current = 'back';
    setProgress(previousStep(steps, progress));
  }, [progress, steps, setProgress]);

  const skipMissing = useCallback(() => {
    if (progress && direction.current === 'back' && canGoBack(steps, progress)) backward();
    else forward();
  }, [progress, steps, backward, forward]);

  const close = useCallback(() => finish('skipped'), [finish]);

  const view = progress
    ? {
        index: progress.index,
        canGoBack: canGoBack(steps, progress),
        isLast: isLastStep(steps, progress),
        pausesAfter: (() => {
          const next = nextStep(steps, progress);
          return next.index === null && !next.finished;
        })(),
      }
    : null;

  return { view, forward, backward, skipMissing, close };
}

/** "Welcome to your workspace": opens once on the dashboard, and again on request. */
export function WorkspaceTour() {
  const tours = useTours();
  const pathname = usePathname();
  const [progress, setProgress] = useState<TourProgress | null>(null);
  const controls = useTourControls(WORKSPACE_TOUR, progress, setProgress);

  const home = !!tours && pathname === `/dashboard/${tours.slug}`;
  const free = !!tours && (tours.active === null || tours.active === 'workspace');
  const wants = home && free && !tours.covered && tours.shouldOpen('workspace');
  const begin = tours?.begin;

  useEffect(() => {
    if (!wants || progress || !begin) return;
    const timer = setTimeout(() => {
      begin('workspace');
      setProgress(startTour(WORKSPACE_TOUR.steps));
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [wants, progress, begin]);

  // Another tour took over, or a replay was asked for: this run is over.
  const active = tours?.active;
  useEffect(() => {
    if (progress && active !== 'workspace') setProgress(null);
  }, [progress, active]);

  if (!tours || !controls.view || tours.covered || tours.active !== 'workspace') return null;
  return (
    <TourRunner
      portal
      steps={WORKSPACE_TOUR.steps}
      {...controls.view}
      onNext={controls.forward}
      onBack={controls.backward}
      onClose={controls.close}
      onMissing={controls.skipMissing}
    />
  );
}

/**
 * "Send your first document": opens the first time the send flow does, and follows it. The
 * steps of each flow step show when the person reaches it.
 */
export function SendTour({ step }: { step: StepKey }) {
  const tours = useTours();
  const [progress, setProgress] = useState<TourProgress | null>(null);
  const controls = useTourControls(SEND_TOUR, progress, setProgress);
  const current = useRef(step);
  current.current = step;

  const setCovered = tours?.setCovered;
  const leave = tours?.leave;
  useEffect(() => {
    if (!setCovered || !leave) return;
    setCovered(true);
    return () => {
      setCovered(false);
      leave('send');
    };
  }, [setCovered, leave]);

  const wants = !!tours && tours.shouldOpen('send');
  const begin = tours?.begin;
  useEffect(() => {
    if (!wants || progress || !begin) return;
    const timer = setTimeout(() => {
      begin('send');
      setProgress(startTour(SEND_TOUR.steps, current.current));
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [wants, progress, begin]);

  useEffect(() => {
    setProgress((p) => (p ? enterChapter(SEND_TOUR.steps, p, step) : p));
  }, [step]);

  const active = tours?.active;
  useEffect(() => {
    if (progress && active !== 'send') setProgress(null);
  }, [progress, active]);

  if (!tours || !controls.view || tours.active !== 'send') return null;
  return (
    <TourRunner
      steps={SEND_TOUR.steps}
      {...controls.view}
      onNext={controls.forward}
      onBack={controls.backward}
      onClose={controls.close}
      onMissing={controls.skipMissing}
      sheetBottom={SEND_BAR_PX}
      waitingNote="The tour continues on the next step of sending."
    />
  );
}
