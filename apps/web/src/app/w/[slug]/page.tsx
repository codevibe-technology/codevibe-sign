import { CheckCircle2, Clock, FileSignature, Send } from 'lucide-react';
import type { Metadata } from 'next';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireWorkspace } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Dashboard' };

const STATS = [
  { label: 'Waiting for others', icon: Clock, tone: 'bg-warning-soft text-warning' },
  { label: 'Sent this month', icon: Send, tone: 'bg-primary-soft text-primary' },
  { label: 'Completed', icon: CheckCircle2, tone: 'bg-success-soft text-success' },
] as const;

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, workspace } = await requireWorkspace(slug);
  return (
    <>
      <PageHeader
        title={`Hello${user.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        description={`Here is what is happening in ${workspace.name}.`}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {STATS.map(({ label, icon: Icon, tone }) => (
          <Card key={label} className="flex items-center gap-4 p-5">
            <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${tone}`}>
              <Icon aria-hidden className="h-5 w-5" />
            </span>
            <div>
              <p className="font-display text-2xl font-bold">0</p>
              <p className="text-sm text-muted">{label}</p>
            </div>
          </Card>
        ))}
      </div>
      <EmptyState
        icon={FileSignature}
        title="Nothing to sign yet"
        description="Documents you send for signature show up here with who has signed and who you are waiting for."
      />
    </>
  );
}
