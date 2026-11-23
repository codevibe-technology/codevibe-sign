import { BRAND_NAME, LOCKUP } from '@/lib/brand-assets';
import { cn } from '@/lib/cn';

/**
 * The Codevibe Sign mark, the same file the docs use as their logo. It is only ever drawn
 * from `/mark.svg`: no second drawing of the logo lives in the code.
 */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/mark.svg" alt="" width={32} height={32} className={`shrink-0 ${className}`} />;
}

/**
 * Where the lockup sits: `light` surfaces (the default, and the docs' own version), `dark` ones
 * such as the navy footer and side panels, or a surface that follows the theme, which gets
 * whichever of the two the theme calls for.
 */
export type WordmarkSurface = 'light' | 'dark' | 'theme';

/**
 * The lockup, mark and "codevibe sign", exactly as the docs header shows it. On a dark surface
 * it is the same lockup in its inverse colours. Sized as codevibe.in sizes its own logo.
 */
export function Wordmark({
  surface = 'light',
  className = 'h-[27px] sm:h-[33px]',
}: {
  surface?: WordmarkSurface;
  className?: string;
}) {
  const image = (src: string, extra?: string) => (
    <img
      src={src}
      alt={BRAND_NAME}
      width={LOCKUP.width}
      height={LOCKUP.height}
      className={cn('w-auto shrink-0', className, extra)}
    />
  );
  if (surface === 'light') return image(LOCKUP.light);
  if (surface === 'dark') return image(LOCKUP.inverse);
  return (
    <>
      {image(LOCKUP.light, 'wordmark-on-light')}
      {image(LOCKUP.inverse, 'wordmark-on-dark')}
    </>
  );
}
