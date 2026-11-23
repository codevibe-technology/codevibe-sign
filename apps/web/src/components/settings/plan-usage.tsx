import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { PER_USE_LIMITS, PLAN_NAMES, formatAmount, type Plan, type PlanLimits } from '@/lib/plans';

export interface UsageMeter {
  key: string;
  label: string;
  used: number;
  max: number | null;
  usedText: string;
  maxText: string | null;
  resetsAt: string | null;
}

const PLAN_LINES: Record<Plan, string> = {
  free: 'Free while you try it out, with room for a small team.',
  cloud: 'For teams that send every day: no monthly envelope count, webhooks and your own brand.',
  unlimited: 'No limits on this workspace.',
};

function tone(used: number, max: number) {
  const share = used / max;
  if (share >= 1) return { bar: 'bg-danger', badge: 'danger' as const, text: 'Limit reached' };
  if (share >= 0.8) return { bar: 'bg-warning', badge: 'warning' as const, text: 'Nearly full' };
  return { bar: 'bg-primary', badge: null, text: null };
}

/** The workspace's plan, how to pay for it, and a meter for every running limit. */
export function PlanUsage({
  plan,
  limits,
  meters,
  billing,
}: {
  plan: Plan;
  limits: PlanLimits;
  meters: UsageMeter[];
  /** The part that pays for the plan; left out where nothing is sold. */
  billing?: ReactNode;
}) {
  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-header px-5 py-5 text-header-ink">
          <div>
            <p className="text-sm opacity-80">Current plan</p>
            <p className="font-display text-2xl font-bold" data-testid="plan-name">
              {PLAN_NAMES[plan]}
            </p>
            <p className="mt-1 text-sm opacity-80">{PLAN_LINES[plan]}</p>
          </div>
        </div>
        {billing}
      </Card>

      <Card>
        <CardHeader
          title="Usage"
          description="Counted as things happen. Each monthly count says when it starts again."
        />
        <ul className="divide-y divide-line">
          {meters.map((meter) => {
            const state =
              meter.max === null || meter.max === 0 ? null : tone(meter.used, meter.max);
            const width =
              meter.max === null || meter.max === 0
                ? 0
                : Math.min(100, Math.round((meter.used / meter.max) * 100));
            return (
              <li key={meter.key} className="px-5 py-4" data-testid={`meter-${meter.key}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{meter.label}</p>
                  <p className="text-sm text-muted">
                    <span className="font-semibold text-ink">{meter.usedText}</span>
                    {meter.max === 0
                      ? ' (not on this plan)'
                      : meter.maxText
                        ? ` of ${meter.maxText}`
                        : ' (no limit)'}
                  </p>
                </div>
                {meter.max !== null && meter.max > 0 ? (
                  <div
                    role="meter"
                    aria-label={meter.label}
                    aria-valuemin={0}
                    aria-valuemax={meter.max}
                    aria-valuenow={Math.min(meter.used, meter.max)}
                    aria-valuetext={`${meter.usedText} of ${meter.maxText}`}
                    className="mt-2 h-2 overflow-hidden rounded-[2px] bg-surface-2"
                  >
                    <div className={cn('h-full', state?.bar)} style={{ width: `${width}%` }} />
                  </div>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {state?.badge ? <Badge tone={state.badge}>{state.text}</Badge> : null}
                  {meter.resetsAt ? <span>Starts again on {meter.resetsAt}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Each send" description="These apply to every upload and bulk send." />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {PER_USE_LIMITS.map((item) => {
              const max = limits[item.key];
              return (
                <div key={item.key} className="flex justify-between gap-3 text-sm">
                  <dt className="text-muted">{item.label}</dt>
                  <dd className="font-semibold">
                    {max === null ? 'No limit' : `Up to ${formatAmount(max, item.unit)}`}
                  </dd>
                </div>
              );
            })}
            <div className="flex justify-between gap-3 text-sm">
              <dt className="text-muted">Custom signing domain</dt>
              <dd className="font-semibold">{limits.customDomain ? 'Included' : 'Cloud plan'}</dd>
            </div>
            <div className="flex justify-between gap-3 text-sm">
              <dt className="text-muted">&ldquo;Secured by Codevibe Sign&rdquo; badge</dt>
              <dd className="font-semibold">
                {limits.badgeRequired ? 'Always shown' : 'Optional'}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
