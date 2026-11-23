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

/** What one workspace adds to the account's counts. */
export interface WorkspaceBreakdown {
  id: string;
  slug: string;
  name: string;
  members: number;
  activeTemplates: number;
  envelopes: number;
  apiRequests: number;
  storageText: string;
  esigns: number;
}

const PLAN_LINES: Record<Plan, string> = {
  free: 'Free while you try it out, with room for a small team.',
  cloud: 'For teams that send every day: no monthly envelope count, webhooks and your own brand.',
  unlimited: 'No limits on this account.',
};

function tone(used: number, max: number) {
  const share = used / max;
  if (share >= 1) return { bar: 'bg-danger', badge: 'danger' as const, text: 'Limit reached' };
  if (share >= 0.8) return { bar: 'bg-warning', badge: 'warning' as const, text: 'Nearly full' };
  return { bar: 'bg-primary', badge: null, text: null };
}

/**
 * The plan of the account a workspace is on, how to pay for it, a meter for every running
 * limit counted over all the account's workspaces, and what each workspace adds.
 */
export function PlanUsage({
  plan,
  limits,
  meters,
  workspaces = [],
  wholeAccount = true,
  currentWorkspaceId,
  billing,
}: {
  plan: Plan;
  limits: PlanLimits;
  meters: UsageMeter[];
  /** The workspaces on the account the reader may see, for the breakdown. */
  workspaces?: WorkspaceBreakdown[];
  /** False when only the reader's own workspace is listed: they do not own the account. */
  wholeAccount?: boolean;
  currentWorkspaceId?: string;
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
          description="Counted across every workspace on this account, as things happen. Each monthly count says when it starts again."
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

      {workspaces.length > 0 ? (
        <Card data-testid="workspace-breakdown">
          <CardHeader
            title="By workspace"
            description={
              wholeAccount
                ? 'What each workspace on this account adds. Someone who is in several workspaces is one person in the count above.'
                : 'What this workspace adds to the counts above. The account owner sees every workspace on the account here.'
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-5 py-2 font-semibold">
                    Workspace
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Members
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Templates
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Envelopes
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    API requests
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Stored
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold">
                    eSigns
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {workspaces.map((row) => (
                  <tr key={row.id} data-testid={`breakdown-${row.slug}`}>
                    <th scope="row" className="px-5 py-3 font-semibold">
                      {row.name}
                      {row.id === currentWorkspaceId ? (
                        <span className="ml-2 font-normal text-muted">(this one)</span>
                      ) : null}
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums">{row.members}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.activeTemplates}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.envelopes}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.apiRequests}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.storageText}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{row.esigns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-muted">
            Envelopes, API requests and eSigns are for the current month.
          </p>
        </Card>
      ) : null}

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
