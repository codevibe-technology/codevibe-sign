'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { STEPS, type StepKey } from '@/lib/send-flow';

/** The flow's steps (the send flow's four by default); reached ones can be revisited. */
export function Stepper<K extends string = StepKey>({
  steps = STEPS as unknown as readonly { key: K; label: string }[],
  current,
  reached,
  onSelect,
}: {
  steps?: readonly { key: K; label: string }[];
  current: K;
  reached: number;
  onSelect: (step: K) => void;
}) {
  const index = steps.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Steps" className="mb-5">
      <p className="mb-2 text-sm font-medium text-muted sm:hidden">
        Step {index + 1} of {steps.length} · <span className="text-ink">{steps[index]!.label}</span>
      </p>
      <ol
        className="grid grid-flow-col gap-1.5 sm:gap-2"
        style={{ gridAutoColumns: 'minmax(0, 1fr)' }}
      >
        {steps.map((step, i) => {
          const done = i < index;
          const active = i === index;
          const reachable = i <= reached;
          return (
            <li key={step.key} className="min-w-0">
              <button
                type="button"
                disabled={!reachable || active}
                onClick={() => onSelect(step.key)}
                aria-current={active ? 'step' : undefined}
                aria-label={step.label}
                className={cn(
                  'group flex w-full min-w-0 flex-col gap-2 text-left disabled:cursor-default',
                  reachable && !active && 'cursor-pointer',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-[3px] w-full transition-colors',
                    active ? 'bg-primary' : done ? 'bg-accent' : 'bg-line',
                    reachable && !active && 'group-hover:bg-primary/60',
                  )}
                />
                <span className="hidden min-w-0 items-center gap-2 sm:flex">
                  <span
                    className={cn(
                      'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[3px] px-1 font-mono text-[10.5px] font-semibold',
                      active && 'bg-primary text-primary-ink',
                      done && 'bg-accent text-accent-ink',
                      !active && !done && 'bg-surface-2 text-muted',
                    )}
                  >
                    {done ? (
                      <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                    ) : (
                      String(i + 1).padStart(2, '0')
                    )}
                  </span>
                  <span
                    className={cn(
                      'truncate text-[13px] font-semibold',
                      active ? 'text-ink' : done ? 'text-ink/80' : 'text-muted',
                    )}
                  >
                    {step.label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
