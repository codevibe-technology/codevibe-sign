import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlanBilling } from '@/components/billing/plan-billing';
import { PlanComparison } from '@/components/billing/plan-comparison';
import { PlanUsage } from '@/components/settings/plan-usage';
import { planFeatures } from '@/lib/plans';
import { canManageBilling } from '@/lib/roles';
import { accountOfWorkspace, accountOwnerName } from '@/server/accounts';
import { requireWorkspace } from '@/server/auth/guards';
import { billingConfig } from '@/server/billing/config';
import { getBillingDetails } from '@/server/billing/details';
import { currentPricing } from '@/server/billing/pricing';
import { planPrices, subscriptionView } from '@/server/billing/subscriptions';
import { db } from '@/server/db';
import { isHosted, planSettings, usageReport } from '@/server/plans';

export const metadata: Metadata = { title: 'Plan and usage' };

/** The prices of a term. Default prices when a billing setting cannot be read; payments are closed then. */
function prices() {
  try {
    return planPrices(billingConfig());
  } catch {
    return planPrices(billingConfig({}));
  }
}

export default async function PlanSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, user, role } = await requireWorkspace(slug);
  if (!isHosted()) notFound();
  const sql = db();
  const settings = planSettings();
  const pricing = currentPricing();
  const account = await accountOfWorkspace(sql, workspace.id);
  const holdsAccount = account.ownerUserId === user.id;
  const canManage = canManageBilling(role, holdsAccount);
  const [report, subscription, details, owner] = await Promise.all([
    usageReport(sql, workspace.id),
    subscriptionView(sql, account.id, new Date()),
    getBillingDetails(sql, account.id),
    canManage ? null : accountOwnerName(sql, workspace.id),
  ]);
  return (
    <>
      <PlanUsage
        plan={report.plan}
        limits={report.limits}
        meters={report.lines}
        workspaces={
          // Only the account owner is sure to be in every workspace; others see their own.
          holdsAccount ? report.workspaces : report.workspaces.filter((w) => w.id === workspace.id)
        }
        currentWorkspaceId={workspace.id}
        wholeAccount={holdsAccount}
        billing={
          report.plan === 'unlimited' && subscription.state !== 'managed' ? null : (
            <PlanBilling
              workspaceId={workspace.id}
              slug={slug}
              subscription={subscription}
              prices={prices()}
              paymentsOpen={pricing.paymentsOpen}
              testMode={pricing.testMode}
              hasBillingDetails={details !== null}
              canManage={canManage}
              managedBy={owner}
            />
          )
        }
      />
      {report.plan === 'unlimited' ? null : (
        <PlanComparison features={planFeatures(settings)} pricing={pricing} current={report.plan} />
      )}
    </>
  );
}
