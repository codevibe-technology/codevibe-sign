'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { STEPS, type StepKey } from '@/lib/send-flow';

/** The four steps; reached ones can be revisited. */
export function Stepper({
  current,
  reached,
  onSelect,
}: {
  current: StepKey;
  reached: number;
  onSelect: (step: StepKey) => void;
}) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Steps" className="mb-6">
      <p className="mb-2 text-sm font-medium text-muted sm:hidden">
        Step {index + 1} of {STEPS.length} · <span className="text-ink">{STEPS[index]!.label}</span>
      </p>
      <ol className="flex items-center gap-2">
        {STEPS.map((step, i) => {
          const done = i < index;
          const active = i === index;
          const reachable = i <= reached;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                disabled={!reachable || active}
                onClick={() => onSelect(step.key)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-lg text-left disabled:cursor-default',
                  reachable && !active && 'hover:opacity-80',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    active && 'bg-primary text-primary-ink',
                    done && 'bg-accent text-accent-ink',
                    !active && !done && 'border border-line-strong bg-surface text-muted',
                  )}
                >
                  {done ? <Check aria-hidden className="h-4 w-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'hidden truncate text-sm font-semibold sm:block',
                    active ? 'text-ink' : 'text-muted',
                  )}
                >
                  {step.label}
                </span>
              </button>
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn('h-0.5 flex-1 rounded-full', done ? 'bg-accent' : 'bg-line')}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
