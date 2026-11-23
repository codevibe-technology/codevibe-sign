import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ManagedBy } from '@/components/billing/managed-by';
import { BillingPanel } from '@/components/settings/billing-panel';
import { accountOfWorkspace, accountOwnerName } from '@/server/accounts';
import { requireWorkspace } from '@/server/auth/guards';
import { billingConfig } from '@/server/billing/config';
import { creditHistory, settleOwedEsigns } from '@/server/billing/credits';
import { billingOverview } from '@/server/billing/overview';
import { db } from '@/server/db';
import { workspaceEntitlements } from '@/server/plans';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, user } = await requireWorkspace(slug, 'billing.manage');
  const sql = db();
  const entitlements = await workspaceEntitlements(sql, workspace.id);
  if (!entitlements.billingVisible) notFound();
  const account = await accountOfWorkspace(sql, workspace.id);
  // Invoices, billing details and credits belong to the account; only its owner sees them.
  if (account.ownerUserId !== user.id) {
    return (
      <ManagedBy
        owner={await accountOwnerName(sql, workspace.id)}
        what="billing details, invoices and eSign credits are kept once"
        hidden
      />
    );
  }
  const config = billingConfig();
  // Credits that are free now pay for eSigns still owed before the page shows a balance.
  const owed = await settleOwedEsigns(sql, account.id);
  const [overview, history] = await Promise.all([
    billingOverview(sql, config, { accountId: account.id, plan: entitlements.plan }),
    creditHistory(sql, account.id),
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
