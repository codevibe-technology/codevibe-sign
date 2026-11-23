import { LocalTime } from '@/components/ui/local-time';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  FilePen,
  FileSignature,
  Hourglass,
  PenLine,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { RemindButton } from '@/components/envelopes/remind-button';
import { StartHereCard } from '@/components/home/start-here-card';
import { LiveUpdates } from '@/components/live/live-updates';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/cn';
import { actionLabel, actionTone } from '@/lib/envelopes';
import { can } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { envelopeCounts, recentActivity, waitingOn } from '@/server/envelopes';
import { startHere } from '@/server/sample-envelope';

export const metadata: Metadata = { title: 'Dashboard' };

const STATS = [
  { key: 'draft', label: 'Drafts', icon: FilePen, bar: 'bg-line-strong', iconTone: 'text-muted' },
  {
    key: 'waiting',
    label: 'Waiting for others',
    icon: Clock,
    bar: 'bg-warning',
    iconTone: 'text-warning',
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: CheckCircle2,
    bar: 'bg-success',
    iconTone: 'text-success',
  },
  { key: 'declined', label: 'Declined', icon: XCircle, bar: 'bg-danger', iconTone: 'text-danger' },
  { key: 'expired', label: 'Expired', icon: Hourglass, bar: 'bg-muted/50', iconTone: 'text-muted' },
] as const;

const DOT: Record<string, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  primary: 'bg-primary',
  neutral: 'bg-line-strong',
  warning: 'bg-warning',
  accent: 'bg-accent',
};

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, workspace, role } = await requireWorkspace(slug);
  const sql = db();
  const canSend = can(role, 'envelopes.write');
  const [counts, mine, activity, sample] = await Promise.all([
    envelopeCounts(sql, workspace.id),
    waitingOn(sql, workspace.id, user.email),
    recentActivity(sql, workspace.id),
    canSend ? startHere(sql, workspace.id) : null,
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sendButton = canSend ? (
    <Button asChild>
      <Link href={`/dashboard/${slug}/envelopes/new`}>
        <Send aria-hidden className="h-4 w-4" />
        Send a document
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title={`Hello${user.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        eyebrow="Dashboard"
        description={`Here is what is happening in ${workspace.name}.`}
        badge={<LiveUpdates workspaceId={workspace.id} />}
        action={sendButton}
      />

      {sample ? (
        <StartHereCard
          workspaceId={workspace.id}
          href={`/dashboard/${slug}/envelopes/new?draft=${encodeURIComponent(sample)}`}
        />
      ) : null}

      <section
        aria-label="Envelopes by status"
        className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5"
      >
        {STATS.map(({ key, label, icon: Icon, bar, iconTone }) => (
          <Link
            key={key}
            href={`/dashboard/${slug}/envelopes?status=${key}`}
            className="group rounded-xl last:col-span-2 lg:last:col-span-1"
          >
            <Card className="relative h-full overflow-hidden px-4 pt-4 pb-3.5 transition-[border-color,box-shadow] group-hover:border-line-strong group-hover:shadow-[0_8px_24px_rgb(13_27_42/0.08)] sm:px-5">
              <span aria-hidden className={cn('absolute inset-x-0 top-0 h-[3px]', bar)} />
              <div className="flex items-start justify-between gap-2">
                <p className="eyebrow truncate">{label}</p>
                <Icon aria-hidden strokeWidth={1.8} className={cn('h-4 w-4 shrink-0', iconTone)} />
              </div>
              <p
                className="mt-3 font-display text-[32px] leading-none font-bold tracking-tight"
                data-testid={`count-${key}`}
              >
                {counts[key]}
              </p>
              <p className="mt-2 flex items-center gap-1 text-[13px] font-medium text-muted group-hover:text-primary">
                View
                <ArrowRight
                  aria-hidden
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </p>
            </Card>
          </Link>
        ))}
      </section>

      {total === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Nothing sent yet"
          description={
            canSend
              ? 'Upload a PDF, add who needs to sign, drop the signature boxes on the page and send. Every step shows up here.'
              : 'When your team sends documents for signature, their progress shows up here.'
          }
          action={sendButton}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="min-w-0 space-y-6 lg:col-span-3">
            {mine.length > 0 ? (
              <Card>
                <CardHeader
                  eyebrow="Your turn"
                  title="Waiting on you"
                  description="It is your turn on these. The signing link is in your email."
                />
                <ul className="divide-y divide-line">
                  {mine.map((item) => (
                    <li
                      key={item.envelopeId}
                      className="flex flex-wrap items-center gap-3 px-5 py-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                        <PenLine aria-hidden className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/dashboard/${slug}/envelopes/${item.envelopeId}`}
                          className="block truncate font-semibold hover:underline"
                        >
                          {item.title}
                        </Link>
                        <p className="text-sm text-muted">
                          Sent
                          {item.sentAt ? (
                            <>
                              {' '}
                              <LocalTime iso={item.sentAt} format="relative" />
                            </>
                          ) : null}
                          {item.expiresAt ? (
                            <>
                              {' · expires '}
                              <LocalTime iso={item.expiresAt} format="relative" />
                            </>
                          ) : null}
                        </p>
                      </div>
                      <RemindButton
                        workspaceId={workspace.id}
                        envelopeId={item.envelopeId}
                        recipientId={item.recipientId}
                        label="Email me the link"
                        success="Check your inbox for a fresh signing link"
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card>
              <CardHeader
                eyebrow="Activity"
                title="Recent activity"
                description="The latest steps across the workspace."
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/dashboard/${slug}/envelopes`}>All envelopes</Link>
                  </Button>
                }
              />
              {activity.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">No activity yet.</p>
              ) : (
                <ol className="px-5 py-2">
                  {activity.map((item, i) => (
                    <li key={`${item.envelopeId}-${item.at}-${i}`} className="flex gap-3 py-2.5">
                      <span
                        aria-hidden
                        className={cn(
                          'mt-[7px] h-2 w-2 shrink-0 rounded-[2px]',
                          DOT[actionTone(item.action)],
                        )}
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-ink">
                          {item.who ? <span className="font-semibold">{item.who}: </span> : null}
                          {actionLabel(item.action)}
                          {' · '}
                          <Link
                            href={`/dashboard/${slug}/envelopes/${item.envelopeId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {item.title}
                          </Link>
                        </p>
                        <p className="text-muted">
                          <LocalTime iso={item.at} format="relative" />
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div className="min-w-0 space-y-6 lg:col-span-2">
            {canSend ? (
              <Card className="overflow-hidden">
                <div className="relative bg-nav px-5 pt-5 pb-6 text-white">
                  <p className="font-mono text-[11px] tracking-[0.12em] text-accent uppercase">
                    New envelope
                  </p>
                  <p className="mt-2 font-display text-xl font-semibold">Send a document</p>
                  <p className="mt-1 text-sm text-nav-ink/75">Four short steps, saved as you go.</p>
                  <span aria-hidden className="absolute bottom-0 left-5 h-[3px] w-10 bg-accent" />
                </div>
                <ol className="space-y-3 px-5 py-5 text-sm">
                  {[
                    'Upload one or more PDFs',
                    'Add who signs, approves or gets a copy',
                    'Drag signature boxes onto the pages',
                    'Review and send',
                  ].map((step, i) => (
                    <li key={step} className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-surface-2 font-mono text-[11px] font-semibold text-ink">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-ink">{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="px-5 pb-5">
                  <Button asChild className="w-full">
                    <Link href={`/dashboard/${slug}/envelopes/new`}>
                      <Send aria-hidden className="h-4 w-4" />
                      Start
                    </Link>
                  </Button>
                </div>
              </Card>
            ) : null}
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-ink">
                  <ShieldCheck aria-hidden className="h-4 w-4" />
                </span>
                <div className="text-sm">
                  <p className="font-semibold">Received a signed PDF?</p>
                  <p className="mt-0.5 text-muted">
                    Check it is exactly the document this workspace sealed.
                  </p>
                  <Link
                    href={`/dashboard/${slug}/verify`}
                    className="mt-2 inline-block font-semibold text-primary hover:underline"
                  >
                    Verify a document
                  </Link>
                </div>
              </div>
            </Card>
            {counts.voided > 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Ban aria-hidden className="h-4 w-4" />
                <Link
                  href={`/dashboard/${slug}/envelopes?status=voided`}
                  className="hover:underline"
                >
                  {counts.voided} voided
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
