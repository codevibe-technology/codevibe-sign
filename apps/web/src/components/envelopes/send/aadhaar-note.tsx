import { Fingerprint } from 'lucide-react';
import { AADHAAR_GUIDE } from '@/components/marketing/links';
import { cn } from '@/lib/cn';
import { AADHAAR_PLACEMENT_NOTE } from '@/lib/send-flow';

/**
 * Where an Aadhaar eSign goes: Leegality places it from the workflow, so the sender places
 * no box and the signer fills in nothing. Shown for that signer in recipients, fields and
 * review.
 */
export function AadhaarPlacementNote({ name, className }: { name?: string; className?: string }) {
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
        {AADHAAR_PLACEMENT_NOTE}{' '}
        <a
          className="font-semibold text-primary hover:underline"
          href={`${AADHAAR_GUIDE}#set-the-signature-position`}
          target="_blank"
          rel="noreferrer"
        >
          How to set the position
        </a>
      </span>
    </p>
  );
}
