import { BRAND_NAME } from '@/lib/brand-assets';

/**
 * The Codevibe Sign mark, the same file the docs use as their logo. It is only ever drawn
 * from `/mark.svg`: no second drawing of the logo lives in the code.
 */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/mark.svg" alt="" width={32} height={32} className={`shrink-0 ${className}`} />;
}

/** The mark with the product name beside it, set as the docs set their title. */
export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className="h-7 w-7" />
      <span className="font-display text-[17px] leading-none font-semibold tracking-[-0.01em]">
        {BRAND_NAME}
      </span>
    </span>
  );
}
