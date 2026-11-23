import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BillingPanel } from '@/components/settings/billing-panel';
import { requireWorkspace } from '@/server/auth/guards';
import { billingConfig } from '@/server/billing/config';
import { creditHistory, settleOwedEsigns } from '@/server/billing/credits';
import { billingOverview } from '@/server/billing/overview';
import { db } from '@/server/db';
import { workspaceEntitlements } from '@/server/plans';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'billing.manage');
  const sql = db();
  const entitlements = await workspaceEntitlements(sql, workspace.id);
  if (!entitlements.billingVisible) notFound();
  const config = billingConfig();
  // Credits that are free now pay for eSigns still owed before the page shows a balance.
  const owed = await settleOwedEsigns(sql, workspace.id);
  const [overview, history] = await Promise.all([
    billingOverview(sql, config, { workspaceId: workspace.id, plan: entitlements.plan }),
    creditHistory(sql, workspace.id),
  ]);
  return (
    <>
      {owed > 0 ? (
        <p
          role="status"
          data-testid="billing-owed"
          className="mb-4 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {owed === 1 ? '1 eSign is owed' : `${owed} eSigns are owed`}:{' '}
          {owed === 1 ? 'it was' : 'they were'} signed when no credit was left. New credits pay for{' '}
          {owed === 1 ? 'it' : 'them'} first, and Aadhaar eSign starts again after that.
        </p>
      ) : null}
      <BillingPanel
        workspaceId={workspace.id}
        sellerStateCode={config.seller?.stateCode ?? null}
        overview={overview}
        history={history}
      />
    </>
  );
}
