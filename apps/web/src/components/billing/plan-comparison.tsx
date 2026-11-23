import { Card, CardHeader } from '@/components/ui/card';
import type { PlanFeature } from '@/lib/plans';
import type { PricingView } from '@/server/billing/pricing';

/** The comparison rows with the Aadhaar eSign row showing what one eSign costs on each plan. */
export function pricedFeatures(features: PlanFeature[], pricing: PricingView): PlanFeature[] {
  return features.map((row) =>
    row.key === 'aadhaarEsign'
      ? { ...row, free: `${pricing.esignFree}, prepaid`, cloud: `${pricing.esignCloud}, prepaid` }
      : row,
  );
}

/** Free and Cloud side by side, row by row, from the one list of plan limits. */
export function PlanComparison({
  features,
  pricing,
  current,
}: {
  features: PlanFeature[];
  pricing: PricingView;
  current: 'free' | 'cloud' | null;
}) {
  const rows = pricedFeatures(features, pricing);
  const mark = (plan: 'free' | 'cloud') =>
    current === plan ? (
      <span className="ml-2 text-[11px] font-medium text-primary">Yours</span>
    ) : null;
  return (
    <Card data-testid="plan-comparison">
      <CardHeader
        title="Free and Cloud"
        description={`Cloud is ${pricing.cloudMonth} a month for a workspace, or ${pricing.cloudYear} a year, plus ${pricing.gstPercent}% GST.`}
      />
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 border-b border-line px-5 py-2.5 text-[13px] font-semibold sm:grid">
        <span className="text-muted">What you get</span>
        <span>Free{mark('free')}</span>
        <span>Cloud{mark('cloud')}</span>
      </div>
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid gap-x-4 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <dt className="font-semibold text-ink sm:font-normal sm:text-muted">{row.label}</dt>
            <dd>
              <span className="mr-1.5 text-[12px] text-muted sm:hidden">Free</span>
              {row.free}
            </dd>
            <dd className="font-medium">
              <span className="mr-1.5 text-[12px] font-normal text-muted sm:hidden">Cloud</span>
              {row.cloud}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
