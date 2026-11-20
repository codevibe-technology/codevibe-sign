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
        'inline-flex items-center gap-1.5 rounded-[3px] px-2 py-[3px] font-mono text-[10.5px] font-medium tracking-[0.06em] whitespace-nowrap uppercase',
        tones[DELIVERY_STATUS_TONES[status]],
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 bg-current" />
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}
