import { ArrowUpRight, Gauge } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { PLAN_NAMES, PRICING_PATH, planPagePath, type Plan } from '@/lib/plans';

/** The numbers a `PLAN_LIMIT` refusal carries; `result.limit` of a failed action. */
export interface UpgradeLimit {
  limit: string;
  used: number | null;
  max: number | null;
  plan: Plan;
  upgradeUrl?: string;
  resetsAt?: string;
}

/**
 * What to show when a plan limit stops something: what was refused, how full the limit is and
 * where to get more. Inside a workspace the button opens its Plan and usage page; elsewhere it
 * opens the pricing section.
 */
export function UpgradePrompt({
  message,
  limit,
  slug,
  className,
}: {
  /** The server's own sentence: it names the limit and the usage. */
  message: string;
  limit?: UpgradeLimit | undefined;
  /** The workspace the person is in, when there is one. */
  slug?: string | undefined;
  className?: string;
}) {
  const free = !limit || limit.plan === 'free';
  const href = slug ? planPagePath(slug) : PRICING_PATH;
  const counted = limit && limit.max !== null && limit.used !== null && limit.max > 0;
  return (
    <div
      role="alert"
      data-testid="upgrade-prompt"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-accent/50 bg-accent-soft px-4 py-3',
        className,
      )}
    >
      <Gauge aria-hidden className="h-5 w-5 shrink-0 text-ink" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold text-ink">{message}</p>
        {counted ? (
          <p className="mt-0.5 text-[13px] text-muted">
            {limit.used!.toLocaleString('en-IN')} of {limit.max!.toLocaleString('en-IN')} used on
            the {PLAN_NAMES[limit.plan]} plan.
          </p>
        ) : null}
      </div>
      <Link
        href={href}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-ink hover:bg-primary-hover"
      >
        {free ? 'See Cloud plan' : 'Plan and usage'}
        <ArrowUpRight aria-hidden className="h-4 w-4" />
      </Link>
    </div>
  );
}
