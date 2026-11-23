import { ArrowUpRight } from 'lucide-react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A link to another site. It opens in a new tab, passes neither the opener nor the referrer,
 * and says so to screen readers; sighted visitors get a small arrow unless `bare` is set.
 */
export function ExternalLink({
  href,
  children,
  className,
  bare = false,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> & {
  href: string;
  children: ReactNode;
  /** Leave out the arrow, for links that already look like buttons. */
  bare?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    >
      {children}
      {bare ? null : <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-70" />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
