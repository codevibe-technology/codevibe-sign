import type { EnvelopeStatus, RecipientStatus } from '@codevibe_technology/sign-core';
import { cn } from '@/lib/cn';
import {
  RECIPIENT_STATUS_LABELS,
  RECIPIENT_STATUS_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  type Tone,
} from '@/lib/envelopes';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

function Pill({ tone, label }: { tone: Tone; label: string }) {
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

export function StatusPill({ status }: { status: EnvelopeStatus }) {
  return <Pill tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} />;
}

export function RecipientStatusPill({ status }: { status: RecipientStatus }) {
  return <Pill tone={RECIPIENT_STATUS_TONES[status]} label={RECIPIENT_STATUS_LABELS[status]} />;
}
