import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const variants = {
  primary: 'bg-primary text-primary-ink hover:bg-primary-hover',
  secondary:
    'bg-surface text-ink border border-line-strong hover:border-primary hover:text-primary',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  icon: 'h-9 w-9 justify-center',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Renders the single child (for example a link) with the button's look. */
  asChild?: boolean;
  pending?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  asChild,
  pending,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-semibold tracking-[-0.005em] whitespace-nowrap transition-[color,background-color,border-color,box-shadow,translate] duration-200 ease-out not-disabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={asChild ? undefined : disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {children}
    </Component>
  );
}
