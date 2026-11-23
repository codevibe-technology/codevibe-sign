import { Download, FileText, Link2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LocalTime } from '@/components/ui/local-time';
import { cn } from '@/lib/cn';
import {
  AUTH_LABELS,
  RECIPIENT_STATUS_LABELS,
  RECIPIENT_STATUS_TONES,
  STATUS_LABELS,
  actionLabel,
} from '@/lib/envelopes';
import { recordPath, type PublicRecordView, type SealState } from '@/lib/public-record';

const ROLE_LABELS = { signer: 'Signer', approver: 'Approver', viewer: 'Gets a copy' } as const;

/** One state for the page: the worst of its documents. */
function overall(view: PublicRecordView): SealState {
  if (view.documents.some((d) => d.seal === 'failed')) return 'failed';
  if (view.documents.some((d) => d.seal === 'pending')) return 'pending';
  return 'verified';
}

const HEADLINE: Record<SealState, { title: string; text: string }> = {
  verified: {
    title: 'Sealed and unchanged',
    text: 'The signed document kept on this site was checked just now. Its seal is intact and it matches the fingerprint recorded when it was sealed.',
  },
  failed: {
    title: 'Seal check failed',
    text: 'The signed document kept on this site did not pass its seal check. Ask the sender before relying on this record.',
  },
  pending: {
    title: 'Sealing in progress',
    text: 'Everyone has signed and the document is being sealed. Open this page again in a minute.',
  },
};

const SEAL_BADGE: Record<SealState, { tone: 'success' | 'danger' | 'warning'; label: string }> = {
  verified: { tone: 'success', label: 'Seal verified' },
  failed: { tone: 'danger', label: 'Seal not valid' },
  pending: { tone: 'warning', label: 'Being sealed' },
};

function Hash({ value }: { value: string }) {
  return <code className="block font-mono text-xs leading-5 break-all text-ink">{value}</code>;
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1">{eyebrow}</p>
      <h2 className="text-[16px] leading-6 font-semibold text-ink">{title}</h2>
    </div>
  );
}

/** The public record of a completed signing: status, people, fingerprints and the trail. */
export function PublicRecord({ view }: { view: PublicRecordView }) {
  const state = overall(view);
  const tone = state === 'verified' ? 'success' : state === 'failed' ? 'danger' : 'warning';
  const Icon =
    state === 'verified' ? ShieldCheck : state === 'failed' ? ShieldAlert : ShieldQuestion;
  const base = recordPath(view.id);
  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow mb-2 flex items-center gap-2">
          <span aria-hidden className="h-[2px] w-5 bg-accent" />
          Signing record
        </p>
        <h1 className="text-[26px] leading-[1.15] font-bold break-words text-ink sm:text-[32px]">
          {view.title}
        </h1>
      </header>

      <Card
        className={cn(
          'overflow-hidden',
          tone === 'success' && 'border-success/50',
          tone === 'danger' && 'border-danger/50',
          tone === 'warning' && 'border-warning/50',
        )}
      >
        <div
          role="status"
          className={cn(
            'flex items-start gap-4 px-5 py-5',
            tone === 'success' && 'bg-success-soft',
            tone === 'danger' && 'bg-danger-soft',
            tone === 'warning' && 'bg-warning-soft',
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              'h-8 w-8 shrink-0',
              tone === 'success' && 'text-success',
              tone === 'danger' && 'text-danger',
              tone === 'warning' && 'text-warning',
            )}
          />
          <div className="min-w-0">
            <p
              data-testid="record-seal"
              className={cn(
                'font-display text-lg font-bold',
                tone === 'success' && 'text-success',
                tone === 'danger' && 'text-danger',
                tone === 'warning' && 'text-warning',
              )}
            >
              {HEADLINE[state].title}
            </p>
            <p className="text-sm text-ink">{HEADLINE[state].text}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 text-sm">
          <dt className="text-muted">Status</dt>
          <dd>{STATUS_LABELS[view.status]}</dd>
          {view.completedAt ? (
            <>
              <dt className="text-muted">Completed</dt>
              <dd>
                <LocalTime iso={view.completedAt} />
              </dd>
            </>
          ) : null}
          <dt className="text-muted">Sent by</dt>
          <dd className="min-w-0 break-words">
            {view.sender.name && view.sender.name !== view.sender.organization
              ? `${view.sender.name}, ${view.sender.organization}`
              : view.sender.organization}
          </dd>
          <dt className="text-muted">Envelope</dt>
          <dd className="min-w-0">
            <Hash value={view.envelopeId} />
          </dd>
        </dl>
      </Card>

      <Card>
        <div className="border-b border-line px-5 py-4">
          <SectionHead eyebrow="Signers" title="Who took part, and when" />
        </div>
        <ul className="divide-y divide-line">
          {view.signers.map((signer, index) => (
            <li
              key={`${signer.name}-${index}`}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-semibold break-words text-ink">{signer.name}</p>
                <p className="break-words text-muted">
                  {[
                    ROLE_LABELS[signer.role],
                    signer.contact,
                    signer.role === 'viewer' ? null : AUTH_LABELS[signer.auth],
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <Badge tone={RECIPIENT_STATUS_TONES[signer.status]}>
                  {RECIPIENT_STATUS_LABELS[signer.status]}
                </Badge>
                {signer.actedAt ? <LocalTime iso={signer.actedAt} className="text-muted" /> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="border-b border-line px-5 py-4">
          <SectionHead eyebrow="Documents" title="Fingerprints (SHA-256)" />
        </div>
        <ul className="divide-y divide-line">
          {view.documents.map((document, index) => (
            <li key={`${document.name}-${index}`} className="px-5 py-4 text-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 font-semibold text-ink">
                  <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted" />
                  <span className="break-words">{document.name}</span>
                  <span className="font-normal whitespace-nowrap text-muted">
                    {document.pageCount} {document.pageCount === 1 ? 'page' : 'pages'}
                  </span>
                </p>
                <Badge tone={SEAL_BADGE[document.seal].tone}>
                  {SEAL_BADGE[document.seal].label}
                </Badge>
              </div>
              <dl className="space-y-2">
                <div>
                  <dt className="text-muted">As sent for signing</dt>
                  <dd>
                    <Hash value={document.sha256} />
                  </dd>
                </div>
                {document.sealedSha256 ? (
                  <div>
                    <dt className="text-muted">Signed and sealed</dt>
                    <dd>
                      <Hash value={document.sealedSha256} />
                    </dd>
                  </div>
                ) : null}
                {document.sealedAt ? (
                  <div>
                    <dt className="text-muted">Sealed</dt>
                    <dd>
                      <LocalTime iso={document.sealedAt} />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-sm text-muted">
          Holding the signed PDF?{' '}
          <Link href="/verify" className="font-semibold text-primary hover:underline">
            Check your copy
          </Link>{' '}
          and compare its SHA-256 with the sealed fingerprint above.
        </p>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <SectionHead eyebrow="Audit trail" title={`${view.trail.length} recorded steps`} />
          <Badge tone={view.chain.valid ? 'success' : 'danger'}>
            {view.chain.valid ? 'Chain intact' : 'Chain broken'}
          </Badge>
        </div>
        <div className="px-5 py-4 text-sm">
          <p className="flex items-start gap-2 text-muted">
            <Link2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {view.chain.valid
              ? 'Each step carries a SHA-256 hash of the one before it. Every hash was recomputed and matches, so no step was changed, removed or added afterwards.'
              : 'A step does not match the hash recorded for it. Ask the sender before relying on this trail.'}
          </p>
          {view.chain.head ? (
            <div className="mt-2 text-muted">
              Chain head
              <Hash value={view.chain.head} />
            </div>
          ) : null}
        </div>
        <ol className="border-t border-line px-5 py-3 text-sm">
          {view.trail.map((event) => (
            <li
              key={event.seq}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2 py-1.5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]"
            >
              <span className="font-mono text-xs leading-5 text-muted">{event.seq}</span>
              <span className="min-w-0 break-words text-ink">
                {actionLabel(event.action)}
                <span className="text-muted"> · {event.actor}</span>
              </span>
              <LocalTime
                iso={event.at}
                className="col-start-2 text-muted sm:col-start-auto sm:text-right"
              />
            </li>
          ))}
        </ol>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Times are shown in your own time zone. Email addresses and phone numbers are partly
          hidden.
        </p>
      </Card>

      <Card>
        <div className="border-b border-line px-5 py-4">
          <SectionHead eyebrow="Downloads" title="Take the record with you" />
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Button asChild size="sm">
            <a href={`${base}/certificate`}>
              <Download aria-hidden className="h-4 w-4" />
              Certificate (PDF)
            </a>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <a href={`${base}/audit-trail`}>
              <Download aria-hidden className="h-4 w-4" />
              Audit trail (PDF)
            </a>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <a href={`${base}/audit-trail?format=json`}>
              <Download aria-hidden className="h-4 w-4" />
              Audit trail (JSON)
            </a>
          </Button>
        </div>
        <p className="border-t border-line px-5 py-3 text-sm text-muted">
          The signed document is not offered here. Everyone who signed it has their copy, and the
          sender can share it.
        </p>
      </Card>
    </div>
  );
}
