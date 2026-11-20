import { cn } from '@/lib/cn';
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_TONES, type DeliveryStatus } from '@/lib/webhooks';

const tones = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

export function DeliveryPill({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        tones[DELIVERY_STATUS_TONES[status]],
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}
