import { BRAND_NAME, LOCKUP } from '@/lib/brand-assets';

/**
 * The Codevibe Sign mark, the same file the docs use as their logo. It is only ever drawn
 * from `/mark.svg`: no second drawing of the logo lives in the code.
 */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/mark.svg" alt="" width={32} height={32} className={`shrink-0 ${className}`} />;
}

/**
 * The lockup, mark and "codevibe sign", in its white version: every place it appears sits on
 * the navy header or panel. Sized as codevibe.in sizes its own logo in the header.
 */
export function Wordmark({ className = 'h-[27px] sm:h-[33px]' }: { className?: string }) {
  return (
    <img
      src={LOCKUP.white}
      alt={BRAND_NAME}
      width={LOCKUP.width}
      height={LOCKUP.height}
      className={`w-auto shrink-0 ${className}`}
    />
  );
}
