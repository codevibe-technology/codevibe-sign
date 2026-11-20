import { ShieldCheck } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { BrandMark } from '@/components/shell/brand-mark';
import { BRAND_FONT_STACKS, isHexColor, textOn } from '@/lib/brand';
import type { SigningBrand } from '@/lib/signing';

/**
 * The frame of every signing screen: the sender's header, their colour on buttons and focus
 * rings, and the "Secured by" badge unless they turned it off. Without a brand it shows ours.
 */
export function SigningShell({
  brand,
  children,
}: {
  brand: SigningBrand | null;
  children: ReactNode;
}) {
  const color = brand && isHexColor(brand.brandColor) ? brand.brandColor : null;
  const style = {
    ...(color
      ? {
          '--primary': color,
          '--primary-hover': color,
          '--primary-ink': textOn(color),
        }
      : {}),
    ...(brand ? { fontFamily: BRAND_FONT_STACKS[brand.font] } : {}),
  } as CSSProperties;
  const showBadge = brand?.showBadge ?? true;

  return (
    <div className="flex min-h-dvh flex-col" style={style} data-testid="signing-shell">
      <header
        className="relative bg-nav text-white"
        style={color ? { background: color, color: textOn(color) } : undefined}
      >
        {color ? null : (
          <span aria-hidden className="absolute bottom-0 left-0 h-[3px] w-full bg-accent/80" />
        )}
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {brand?.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt=""
              className="h-9 max-w-[140px] rounded bg-white/95 object-contain p-0.5"
            />
          ) : brand ? (
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded bg-white/20 font-bold"
            >
              {brand.name.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <BrandMark />
          )}
          <span className="truncate font-display text-base font-semibold tracking-tight">
            {brand?.name ?? 'Codevibe Sign'}
          </span>
          <span className="ml-auto hidden font-mono text-[10.5px] tracking-[0.12em] uppercase opacity-70 sm:inline">
            Secure signing
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        {children}
      </main>
      {showBadge ? (
        <footer className="px-4 pb-6 text-center font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          <span className="inline-flex items-center gap-1.5" data-testid="secured-badge">
            <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-accent" />
            Secured by Codevibe Sign
          </span>
        </footer>
      ) : null}
    </div>
  );
}

/** A centred card with an icon, a heading and what to do next. */
export function SigningMessage({
  icon,
  title,
  children,
  tone = 'neutral',
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const tones = {
    neutral: 'bg-surface-2 text-ink',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
  };
  return (
    <section className="mx-auto max-w-lg rounded-xl border border-line border-t-[3px] border-t-accent bg-surface p-6 text-center shadow-card sm:p-8">
      <span
        className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md ${tones[tone]}`}
      >
        {icon}
      </span>
      <h1 className="text-[22px] leading-tight font-bold" tabIndex={-1} data-autofocus>
        {title}
      </h1>
      <div className="mt-2 space-y-3 text-muted">{children}</div>
    </section>
  );
}
