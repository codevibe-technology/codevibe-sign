import { textOn } from '@/lib/brand';
import { cn } from '@/lib/cn';

/**
 * A workspace's logo for a header. A wide logo already carries the name, so it stands alone
 * at header height; a square mark gets the name typed beside it; without a logo the name's
 * first letter in the brand colour stands in for the mark.
 */
export function BrandLogo({
  name,
  logoUrl,
  logoWide = false,
  color,
  className,
}: {
  name: string;
  logoUrl: string | null;
  logoWide?: boolean;
  /** The brand colour, for the letter shown without a logo. */
  color: string | null;
  className?: string;
}) {
  if (logoUrl && logoWide) {
    return (
      <img
        src={logoUrl}
        alt={name}
        data-testid="brand-logo"
        data-shape="wide"
        className={cn('h-7 w-auto max-w-[180px] object-contain object-left sm:h-8', className)}
      />
    );
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          data-testid="brand-logo"
          data-shape="mark"
          className="h-8 w-8 shrink-0 object-contain sm:h-9 sm:w-9"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-[15px] font-bold"
          style={{
            background: color ?? 'var(--primary)',
            color: color ? textOn(color) : 'var(--primary-ink)',
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 truncate font-display text-[15px] font-semibold tracking-tight text-ink sm:text-base">
        {name}
      </span>
    </span>
  );
}
