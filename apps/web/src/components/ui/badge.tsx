import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const tones = {
  neutral: 'bg-surface-2 text-ink',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] px-2 py-[3px] font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
