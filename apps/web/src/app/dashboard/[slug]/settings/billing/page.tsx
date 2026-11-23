import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BillingPanel } from '@/components/settings/billing-panel';
import { requireWorkspace } from '@/server/auth/guards';
import { billingConfig } from '@/server/billing/config';
import { creditHistory } from '@/server/billing/credits';
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
  const [overview, history] = await Promise.all([
    billingOverview(sql, config, { workspaceId: workspace.id, plan: entitlements.plan }),
    creditHistory(sql, workspace.id),
  ]);
  return (
    <BillingPanel
      workspaceId={workspace.id}
      sellerStateCode={config.seller?.stateCode ?? null}
      overview={overview}
      history={history}
    />
  );
}
