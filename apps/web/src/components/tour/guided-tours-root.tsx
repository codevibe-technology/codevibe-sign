'use client';

import type { ReactNode } from 'react';
import type { TourId, TourStatus } from '@/lib/tours';
import { WorkspaceTour } from './guided-tours';
import { TourProvider } from './tour-provider';

export interface TourSetup {
  statuses: Partial<Record<TourId, TourStatus>>;
  canSend: boolean;
}

/** The tours of a workspace, and the welcome tour itself, around the workspace pages. */
export function GuidedTours({
  slug,
  setup,
  children,
}: {
  slug: string;
  setup: TourSetup | undefined;
  children: ReactNode;
}) {
  if (!setup) return children;
  return (
    <TourProvider slug={slug} statuses={setup.statuses} canSend={setup.canSend}>
      {children}
      <WorkspaceTour />
    </TourProvider>
  );
}
