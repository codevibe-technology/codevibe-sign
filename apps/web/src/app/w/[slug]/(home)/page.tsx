import {
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
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/cn';
import { actionLabel, actionTone, relativeTime } from '@/lib/envelopes';
import { can } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { envelopeCounts, recentActivity, waitingOn } from '@/server/envelopes';

export const metadata: Metadata = { title: 'Dashboard' };

const STATS = [
  { key: 'draft', label: 'Drafts', icon: FilePen, tone: 'bg-surface-2 text-ink' },
  {
    key: 'waiting',
    label: 'Waiting for others',
    icon: Clock,
    tone: 'bg-warning-soft text-warning',
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: CheckCircle2,
    tone: 'bg-success-soft text-success',
  },
  { key: 'declined', label: 'Declined', icon: XCircle, tone: 'bg-danger-soft text-danger' },
  { key: 'expired', label: 'Expired', icon: Hourglass, tone: 'bg-surface-2 text-muted' },
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
  const [counts, mine, activity] = await Promise.all([
    envelopeCounts(sql, workspace.id),
    waitingOn(sql, workspace.id, user.email),
    recentActivity(sql, workspace.id),
  ]);
  const canSend = can(role, 'envelopes.write');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sendButton = canSend ? (
    <Button asChild>
      <Link href={`/w/${slug}/envelopes/new`}>
        <Send aria-hidden className="h-4 w-4" />
        Send a document
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title={`Hello${user.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        description={`Here is what is happening in ${workspace.name}.`}
        action={sendButton}
      />

      <section
        aria-label="Envelopes by status"
        className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5"
      >
        {STATS.map(({ key, label, icon: Icon, tone }) => (
          <Link
            key={key}
            href={`/w/${slug}/envelopes?status=${key}`}
            className="group rounded-xl last:col-span-2 lg:last:col-span-1"
          >
            <Card className="flex h-full items-center gap-3 p-4 transition-colors group-hover:border-line-strong sm:p-5">
              <span
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  tone,
                )}
              >
                <Icon aria-hidden className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p
                  className="font-display text-2xl leading-7 font-bold"
                  data-testid={`count-${key}`}
                >
                  {counts[key]}
                </p>
                <p className="truncate text-sm text-muted">{label}</p>
              </div>
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
                  title="Waiting on you"
                  description="It is your turn on these. The signing link is in your email."
                />
                <ul className="divide-y divide-line">
                  {mine.map((item) => (
                    <li
                      key={item.envelopeId}
                      className="flex flex-wrap items-center gap-3 px-5 py-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                        <PenLine aria-hidden className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/w/${slug}/envelopes/${item.envelopeId}`}
                          className="block truncate font-semibold hover:underline"
                        >
                          {item.title}
                        </Link>
                        <p className="text-sm text-muted">
                          {item.sentAt ? `Sent ${relativeTime(item.sentAt)}` : 'Sent'}
                          {item.expiresAt ? ` · expires ${relativeTime(item.expiresAt)}` : ''}
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
                title="Recent activity"
                description="The latest steps across the workspace."
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/w/${slug}/envelopes`}>All envelopes</Link>
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
                          'mt-2 h-2 w-2 shrink-0 rounded-full',
                          DOT[actionTone(item.action)],
                        )}
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-ink">
                          {item.who ? <span className="font-semibold">{item.who}: </span> : null}
                          {actionLabel(item.action)}
                          {' · '}
                          <Link
                            href={`/w/${slug}/envelopes/${item.envelopeId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {item.title}
                          </Link>
                        </p>
                        <p className="text-muted">
                          <time dateTime={item.at}>{relativeTime(item.at)}</time>
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
                <div className="bg-header px-5 py-5 text-header-ink">
                  <p className="font-display text-lg font-semibold">Send a document</p>
                  <p className="mt-1 text-sm opacity-80">Four short steps, saved as you go.</p>
                </div>
                <ol className="space-y-2 px-5 py-4 text-sm text-muted">
                  <li>1. Upload one or more PDFs</li>
                  <li>2. Add who signs, approves or gets a copy</li>
                  <li>3. Drag signature boxes onto the pages</li>
                  <li>4. Review and send</li>
                </ol>
                <div className="px-5 pb-5">
                  <Button asChild className="w-full">
                    <Link href={`/w/${slug}/envelopes/new`}>
                      <Send aria-hidden className="h-4 w-4" />
                      Start
                    </Link>
                  </Button>
                </div>
              </Card>
            ) : null}
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-ink">
                  <ShieldCheck aria-hidden className="h-4 w-4" />
                </span>
                <div className="text-sm">
                  <p className="font-semibold">Received a signed PDF?</p>
                  <p className="mt-0.5 text-muted">
                    Check it is exactly the document this workspace sealed.
                  </p>
                  <Link
                    href={`/w/${slug}/verify`}
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
                <Link href={`/w/${slug}/envelopes?status=voided`} className="hover:underline">
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
