import { LocalTime } from '@/components/ui/local-time';
import type { Envelope } from '@codevibe_technology/sign-core';
import { XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ROLE_OPTIONS } from '@/lib/envelopes';

const ROLE = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label.toLowerCase()]));

/** Who declined a declined envelope, and what they wrote, at the top of its page. */
export function declineOf(envelope: Pick<Envelope, 'status' | 'recipients'>) {
  if (envelope.status !== 'declined') return null;
  const r = envelope.recipients.find((x) => x.status === 'declined');
  if (!r) return null;
  return {
    name: r.name,
    role: r.role,
    at: r.actedAt ?? null,
    reason: r.declineReason ?? null,
  };
}

export function DeclineBanner({
  envelope,
  action,
}: {
  envelope: Pick<Envelope, 'status' | 'recipients'>;
  action?: ReactNode;
}) {
  const decline = declineOf(envelope);
  if (!decline) return null;
  return (
    <section
      aria-label="Declined"
      className="mb-6 flex flex-wrap items-start gap-4 rounded-xl border border-danger/30 bg-danger-soft px-5 py-4"
    >
      <XCircle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-ink">
          Declined by {decline.name} ({ROLE[decline.role] ?? decline.role})
          {decline.at ? (
            <>
              {' '}
              on <LocalTime iso={decline.at} />
            </>
          ) : null}
        </p>
        <p className="mt-1 break-words whitespace-pre-line text-ink">
          {decline.reason ? `“${decline.reason}”` : 'No reason was given.'}
        </p>
        <p className="mt-2 text-muted">
          This envelope stays declined. Revise and resend makes a copy for you to fix and send;
          everyone signs it again.
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </section>
  );
}
