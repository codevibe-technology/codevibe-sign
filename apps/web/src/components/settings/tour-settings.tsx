'use client';

import { Compass, Send } from 'lucide-react';
import { useTours } from '@/components/tour/tour-provider';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { TOURS, type TourId, type TourStatus } from '@/lib/tours';

const STATUS: Record<TourStatus, string> = {
  started: 'Started',
  done: 'Finished',
  skipped: 'Skipped',
};

const ROWS: { tour: TourId; icon: typeof Compass; lead: string }[] = [
  {
    tour: 'workspace',
    icon: Compass,
    lead: 'A minute around the dashboard, envelopes, templates and settings.',
  },
  { tour: 'send', icon: Send, lead: 'Documents, recipients, fields and review, step by step.' },
];

/** Settings, Personal: replay a guided tour. */
export function TourSettings() {
  const tours = useTours();
  if (!tours) return null;
  const rows = ROWS.filter((r) => r.tour !== 'send' || tours.canSend);
  return (
    <Card>
      <CardHeader
        title="Guided tours"
        description="Short walkthroughs of the app. Replay one whenever you like."
      />
      <ul className="divide-y divide-line">
        {rows.map(({ tour, icon: Icon, lead }) => {
          const status = tours.statuses[tour];
          return (
            <li key={tour} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary"
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 basis-56 text-sm">
                <p className="font-semibold text-ink">{TOURS[tour].name}</p>
                <p className="mt-0.5 text-muted">
                  {lead}{' '}
                  <span className="text-ink/70">{status ? STATUS[status] : 'Not taken yet'}.</span>
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                pill
                aria-label={`Replay the tour: ${TOURS[tour].name}`}
                onClick={() => tours.replay(tour)}
              >
                Replay the tour
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
