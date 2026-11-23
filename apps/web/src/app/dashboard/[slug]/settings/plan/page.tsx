import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlanUsage } from '@/components/settings/plan-usage';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { isHosted, usageReport } from '@/server/plans';

export const metadata: Metadata = { title: 'Plan and usage' };

export default async function PlanSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  if (!isHosted()) notFound();
  const report = await usageReport(db(), workspace.id);
  return <PlanUsage plan={report.plan} limits={report.limits} meters={report.lines} />;
}
