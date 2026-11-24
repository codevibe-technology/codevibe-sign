import { Fingerprint } from 'lucide-react';
import { AADHAAR_GUIDE } from '@/components/marketing/links';
import { cn } from '@/lib/cn';
import { aadhaarPlacementNote } from '@/lib/send-flow';

/**
 * Where an Aadhaar eSign goes: at the Aadhaar seal position the sender placed, or where the
 * Leegality workflow says. The signer fills in nothing. Shown for that signer in recipients,
 * fields and review.
 */
export function AadhaarPlacementNote({
  name,
  placed = false,
  supported,
  className,
}: {
  name?: string;
  /** The sender placed the Aadhaar seal position. */
  placed?: boolean;
  /** The Leegality account in use can place it; unknown when left out. */
  supported?: boolean;
  className?: string;
}) {
  return (
    <p
      role="note"
      data-testid="aadhaar-placement-note"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary-soft px-3.5 py-3 text-[13px] text-ink',
        className,
      )}
    >
      <Fingerprint aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>
        {name ? (
          <>
            <strong className="font-semibold">{name}</strong> signs with Aadhaar eSign.{' '}
          </>
        ) : null}
        {aadhaarPlacementNote({ placed, ...(supported !== undefined ? { supported } : {}) })}{' '}
        <a
          className="font-semibold text-primary hover:underline"
          href={`${AADHAAR_GUIDE}#choose-where-the-signature-goes`}
          target="_blank"
          rel="noreferrer"
        >
          How the position works
        </a>
      </span>
    </p>
  );
}
