'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TourId, TourStatus } from '@/lib/tours';
import { recordTourAction } from '@/server/actions/tours';

export interface ToursValue {
  slug: string;
  /** How far this person got with each tour; missing means never opened. */
  statuses: Partial<Record<TourId, TourStatus>>;
  /** The tour on screen now, if any. */
  active: TourId | null;
  /** Whether a full-window flow (sending) sits over the workspace pages. */
  covered: boolean;
  canSend: boolean;
  /** A tour opens on its own the first time, and again when asked to replay. */
  shouldOpen: (tour: TourId) => boolean;
  begin: (tour: TourId) => void;
  end: (tour: TourId, status: Exclude<TourStatus, 'started'>) => void;
  /** Stops showing a tour without saving anything, as when its page closes. */
  leave: (tour: TourId) => void;
  setCovered: (covered: boolean) => void;
  /** Opens the page the tour starts on and runs it there again. */
  replay: (tour: TourId) => void;
}

const ToursContext = createContext<ToursValue | null>(null);

/** Null outside a workspace, where there are no tours. */
export const useTours = () => useContext(ToursContext);

export function TourProvider({
  slug,
  statuses: initial,
  canSend,
  children,
}: {
  slug: string;
  statuses: Partial<Record<TourId, TourStatus>>;
  canSend: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState(initial);
  const [active, setActive] = useState<TourId | null>(null);
  const [requested, setRequested] = useState<TourId | null>(null);
  const [covered, setCovered] = useState(false);

  const save = useCallback((tour: TourId, status: TourStatus) => {
    setStatuses((s) => ({ ...s, [tour]: status }));
    // Losing this only means the tour may open once more; it is not worth an error.
    void recordTourAction({ tour, status }).catch(() => undefined);
  }, []);

  const begin = useCallback(
    (tour: TourId) => {
      setActive(tour);
      setRequested((r) => (r === tour ? null : r));
      if (!statuses[tour]) save(tour, 'started');
    },
    [statuses, save],
  );

  const end = useCallback(
    (tour: TourId, status: Exclude<TourStatus, 'started'>) => {
      setActive((a) => (a === tour ? null : a));
      save(tour, status);
    },
    [save],
  );

  const leave = useCallback((tour: TourId) => setActive((a) => (a === tour ? null : a)), []);

  const replay = useCallback(
    (tour: TourId) => {
      setActive(null);
      setRequested(tour);
      router.push(tour === 'send' ? `/dashboard/${slug}/envelopes/new` : `/dashboard/${slug}`);
    },
    [router, slug],
  );

  const value = useMemo<ToursValue>(
    () => ({
      slug,
      statuses,
      active,
      covered,
      canSend,
      shouldOpen: (tour) => requested === tour || !statuses[tour],
      begin,
      end,
      leave,
      setCovered,
      replay,
    }),
    [slug, statuses, active, covered, canSend, requested, begin, end, leave, replay],
  );
  return <ToursContext.Provider value={value}>{children}</ToursContext.Provider>;
}
