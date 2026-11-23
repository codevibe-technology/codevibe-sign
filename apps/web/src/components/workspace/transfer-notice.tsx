import { ArrowRightLeft } from 'lucide-react';
import Link from 'next/link';

export interface TransferOffer {
  id: string;
  workspaceName: string;
  fromName: string | null;
}

/** The in-app notice of workspaces offered to the signed-in person, above every page. */
export function TransferNotice({ offers }: { offers: TransferOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <div className="mb-6 space-y-2" data-testid="transfer-notice">
      {offers.map((offer) => (
        <div
          key={offer.id}
          role="status"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-accent/50 bg-accent-soft px-4 py-3"
        >
          <ArrowRightLeft aria-hidden className="h-5 w-5 shrink-0 text-ink" />
          <p className="min-w-0 flex-1 basis-56 text-sm text-ink">
            <span className="font-semibold">
              {offer.fromName ?? 'Someone'} offered you the {offer.workspaceName} workspace.
            </span>{' '}
            Accept it to move it to your account, or decline.
          </p>
          <Link
            href={`/transfer/${offer.id}`}
            className="inline-flex h-9 shrink-0 items-center rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-ink hover:bg-primary-hover"
          >
            Review the offer
          </Link>
        </div>
      ))}
    </div>
  );
}
