import { cn } from '@/lib/cn';
import type { BulkRowStatus, BulkSendView } from '@/lib/bulk-send';

const tones = {
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-2 text-muted',
} as const;

function Pill({ tone, label }: { tone: keyof typeof tones; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        tones[tone],
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function BulkStatusPill({ bulk }: { bulk: Pick<BulkSendView, 'status' | 'failed'> }) {
  if (bulk.status === 'sending') return <Pill tone="primary" label="Sending" />;
  if (bulk.status === 'cancelled') return <Pill tone="neutral" label="Stopped" />;
  return bulk.failed > 0 ? (
    <Pill tone="warning" label="Done with problems" />
  ) : (
    <Pill tone="success" label="Done" />
  );
}

export function BulkRowPill({ status }: { status: BulkRowStatus }) {
  return status === 'sent' ? (
    <Pill tone="success" label="Sent" />
  ) : status === 'failed' ? (
    <Pill tone="danger" label="Not sent" />
  ) : (
    <Pill tone="neutral" label="Waiting" />
  );
}
