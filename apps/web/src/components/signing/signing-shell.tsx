import { LockKeyhole, ShieldCheck } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Wordmark } from '@/components/shell/brand-mark';
import { BRAND_FONT_STACKS, isHexColor, textOn } from '@/lib/brand';
import type { SigningBrand } from '@/lib/signing';

/**
 * The frame of every signing screen: the sender's name and logo on a light header, their
 * colour on the stripe above it, on buttons and on focus rings, and the "Secured by" badge
 * unless they turned it off. Without a brand it shows ours.
 */
export function SigningShell({
  brand,
  fill = false,
  children,
}: {
  brand: SigningBrand | null;
  /**
   * Fits the frame to the window so the step inside can fill what is left: the document
   * scrolls in its own area and the buttons under it never leave the screen. On a window too
   * short for that the page scrolls as usual.
   */
  fill?: boolean;
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
    <div
      className={
        fill
          ? 'flex h-dvh min-h-[520px] flex-col bg-canvas'
          : 'flex min-h-dvh flex-col bg-[radial-gradient(1200px_480px_at_50%_-120px,var(--primary-soft),transparent)] bg-canvas'
      }
      style={style}
      data-testid="signing-shell"
    >
      <header className="relative shrink-0 border-b border-line bg-surface">
        <span
          aria-hidden
          data-brand-stripe
          className="absolute top-0 left-0 h-[3px] w-full"
          style={{
            background: color ?? 'linear-gradient(90deg, var(--primary), var(--accent))',
          }}
        />
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:h-16">
          {brand?.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt=""
              className="h-8 max-w-[132px] object-contain sm:h-9 sm:max-w-[160px]"
            />
          ) : brand ? (
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-[15px] font-bold"
              style={{
                background: color ?? 'var(--primary)',
                color: color ? textOn(color) : 'var(--primary-ink)',
              }}
            >
              {brand.name.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <Wordmark surface="light" className="h-[24px] sm:h-[28px]" />
          )}
          {brand ? (
            <span className="min-w-0 truncate font-display text-[15px] font-semibold tracking-tight text-ink sm:text-base">
              {brand.name}
            </span>
          ) : null}
          {showBadge ? (
            <span
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pr-3 pl-1.5 text-[12px] font-semibold text-ink"
              data-testid="secured-badge"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success-soft text-success">
                <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
              </span>
              <span className="hidden sm:inline">Secured by</span>
              <Wordmark surface="light" className="h-[15px] sm:h-[16px]" />
            </span>
          ) : (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-muted">
              <LockKeyhole aria-hidden className="h-3.5 w-3.5" />
              Secure signing
            </span>
          )}
        </div>
      </header>
      <main
        id="main"
        className={
          fill
            ? 'mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-2 pt-2 pb-0 sm:px-4 sm:pt-4 sm:pb-4'
            : 'mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-14'
        }
      >
        {children}
      </main>
      {fill ? null : (
        <footer className="px-4 pb-6 text-center text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole aria-hidden className="h-3.5 w-3.5" />
            Every step is recorded in a tamper-evident audit trail
          </span>
        </footer>
      )}
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
    neutral: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
  };
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-line bg-surface p-6 text-center shadow-[0_1px_2px_rgb(13_27_42/0.06),0_18px_40px_-18px_rgb(13_27_42/0.25)] sm:p-10">
      <span
        className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ring-8 ring-surface-2/70 ${tones[tone]}`}
      >
        {icon}
      </span>
      <h1
        className="text-[24px] leading-tight font-bold sm:text-[26px]"
        tabIndex={-1}
        data-autofocus
      >
        {title}
      </h1>
      <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}
