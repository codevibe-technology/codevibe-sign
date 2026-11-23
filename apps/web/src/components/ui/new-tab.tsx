import { ExternalLink } from 'lucide-react';

/** What a link that leaves the app needs so the person keeps their place here. */
export const newTab = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The small arrow after such a link, with the words a screen reader says for it. */
export function NewTabMark({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <>
      <ExternalLink aria-hidden strokeWidth={2} className={`inline-block shrink-0 ${className}`} />
      <span className="sr-only"> (opens in a new tab)</span>
    </>
  );
}
