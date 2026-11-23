import { LocalTime } from '@/components/ui/local-time';
import type { AuditEvent } from '@codevibe_technology/sign-core';
import type { ApiEnvelope as Envelope } from '@codevibe_technology/sign-server';
import {
  CheckCircle2,
  Download,
  FileText,
  Fingerprint,
  Link2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { copyMailLine, type CopyMailStatus } from '@/lib/mail-log';
import {
  AUTH_LABELS,
  ROLE_OPTIONS,
  actionLabel,
  actionTone,
  authLabel,
  eventDetail,
} from '@/lib/envelopes';
import type { CertificateView, SealCheck } from '@/server/sign/api';
import { CorrectRecipientButton, ShareLinkButton } from './recipient-fixes';
import { RemindButton } from './remind-button';
import { RecipientStatusPill } from './status-pill';

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

const DOT: Record<string, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  primary: 'bg-primary',
  neutral: 'bg-line-strong',
  warning: 'bg-warning',
  accent: 'bg-accent',
};

export function ChainBadge({ valid }: { valid: boolean }) {
  return valid ? (
    <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-success-soft px-2 py-[3px] font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase text-success">
      <Link2 aria-hidden className="h-3.5 w-3.5" />
      Audit chain intact
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-danger-soft px-2 py-[3px] font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase text-danger">
      <ShieldAlert aria-hidden className="h-3.5 w-3.5" />
      Audit chain broken
    </span>
  );
}

export function SealBadge({ check }: { check: SealCheck | null }) {
  if (!check) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
        Sealing in progress
      </span>
    );
  }
  return check.valid ? (
    <span
      className="inline-flex items-center gap-1.5 rounded-[3px] bg-success-soft px-2 py-[3px] font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase text-success"
      title={check.signer?.commonName ? `Sealed by ${check.signer.commonName}` : undefined}
    >
      <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
      Seal verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-danger-soft px-2 py-[3px] font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase text-danger">
      <ShieldAlert aria-hidden className="h-3.5 w-3.5" />
      Seal not valid
    </span>
  );
}

export function DocumentsCard({
  slug,
  envelope,
  checks,
  separateCertificates = [],
}: {
  slug: string;
  envelope: Envelope;
  checks: Record<string, SealCheck | null>;
  /**
   * Documents whose certificate is a file of its own: an Aadhaar eSign started before the
   * certificate page went on the file signed.
   */
  separateCertificates?: readonly string[];
}) {
  const completed = envelope.status === 'completed';
  const esigned = envelope.recipients.some((r) => r.auth === 'aadhaar');
  const base = `/dashboard/${slug}/envelopes/${envelope.id}/documents`;
  return (
    <Card>
      <CardHeader
        title="Documents"
        description={
          completed && esigned
            ? 'The signed copy is one file: the pages and the certificate page, under the Aadhaar eSign and a digital seal.'
            : completed
              ? 'The signed copies carry a digital seal and a certificate page.'
              : 'The files as they were uploaded.'
        }
      />
      <ul className="divide-y divide-line">
        {envelope.documents.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <FileText aria-hidden className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{d.name}</p>
              <p className="text-sm text-muted">
                {d.pageCount} {d.pageCount === 1 ? 'page' : 'pages'}
              </p>
            </div>
            {completed ? <SealBadge check={checks[d.id] ?? null} /> : null}
            <div className="flex flex-wrap gap-2">
              {completed && checks[d.id] ? (
                <Button asChild size="sm">
                  <a href={`${base}/${d.id}?version=sealed`}>
                    <Download aria-hidden className="h-4 w-4" />
                    Signed PDF
                  </a>
                </Button>
              ) : null}
              {completed && separateCertificates.includes(d.id) && checks[d.id] ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={`${base}/${d.id}?version=certificate`}>
                    <Download aria-hidden className="h-4 w-4" />
                    Certificate
                  </a>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="secondary">
                <a href={`${base}/${d.id}?version=original`}>
                  <Download aria-hidden className="h-4 w-4" />
                  Original
                </a>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RecipientsCard({
  workspaceId,
  envelope,
  currentIds,
  canRemind,
  copyMail = {},
  canShareLinks = false,
  canCorrect = false,
}: {
  workspaceId: string;
  envelope: Envelope;
  currentIds: string[];
  canRemind: boolean;
  /** Admins: a link to pass on by hand for whoever's turn it is. */
  canShareLinks?: boolean;
  /** Senders, on an open envelope: correct anyone who has not acted. */
  canCorrect?: boolean;
  /** The completed-copy email to each recipient, by recipient id, from the mail log. */
  copyMail?: Record<string, CopyMailStatus>;
}) {
  const sequential = envelope.routing === 'sequential';
  return (
    <Card>
      <CardHeader
        title="Recipients"
        description={
          sequential
            ? 'They sign one after another, in this order.'
            : 'Everyone was invited at the same time.'
        }
      />
      <ol className="divide-y divide-line">
        {envelope.recipients.map((r, i) => {
          const current = currentIds.includes(r.id);
          const copy = envelope.status === 'completed' ? copyMail[r.id] : undefined;
          const acted = r.status === 'signed' || r.status === 'approved' || r.status === 'declined';
          const target = {
            workspaceId,
            envelopeId: envelope.id,
            recipient: { id: r.id, name: r.name, email: r.email ?? null, phone: r.phone ?? null },
          };
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span
                aria-hidden
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-[13px] font-semibold',
                  current ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted',
                )}
              >
                {sequential && r.role !== 'viewer' ? i + 1 : r.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {r.name}
                  <span className="ml-2 font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted uppercase">
                    {ROLE_LABEL[r.role]} · {authLabel(r)}
                  </span>
                </p>
                <p className="truncate text-sm text-muted">
                  {r.email}
                  {r.phone ? ` · ${r.phone}` : ''}
                </p>
                {r.esign && !acted && r.esign.status !== 'signed' ? (
                  <p className="mt-1 text-sm text-muted" data-testid={`esign-state-${r.id}`}>
                    {r.esign.status === 'pending'
                      ? 'At the eSign provider now, confirming with an Aadhaar one-time code.'
                      : 'The last Aadhaar eSign did not finish. They can start again from their link.'}
                  </p>
                ) : null}
                {r.declineReason ? (
                  <p className="mt-1 text-sm text-danger">Reason: {r.declineReason}</p>
                ) : null}
                {copy ? (
                  <p
                    className={cn(
                      'mt-1 text-xs break-words',
                      copy.status === 'sent' ? 'text-muted' : 'text-danger',
                    )}
                    data-testid={`copy-mail-${r.id}`}
                  >
                    {copy.status === 'sent' ? (
                      <>
                        Copy emailed <LocalTime iso={copy.at} format="short" />
                      </>
                    ) : (
                      copyMailLine(copy)
                    )}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RecipientStatusPill status={r.status} />
                {r.actedAt ? (
                  <LocalTime iso={r.actedAt} format="relative" className="text-xs text-muted" />
                ) : null}
                {current && canRemind ? (
                  <RemindButton
                    workspaceId={workspaceId}
                    envelopeId={envelope.id}
                    recipientId={r.id}
                    label="Resend link"
                    success={`A fresh signing link is on its way to ${r.name}`}
                  />
                ) : null}
                {current && canShareLinks ? <ShareLinkButton {...target} /> : null}
                {canCorrect && !acted ? (
                  <CorrectRecipientButton {...target} current={current} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {canCorrect &&
      envelope.recipients.some((r) => r.status === 'signed' || r.status === 'approved') ? (
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Someone who has already signed cannot be changed here. Use Recall and edit to correct the
          envelope and send it again.
        </p>
      ) : null}
    </Card>
  );
}

export function Timeline({
  events,
  chainValid,
  envelope,
  slug,
}: {
  events: AuditEvent[];
  chainValid: boolean;
  envelope: Envelope;
  /** Links a recalled or revised envelope to its copy. */
  slug?: string;
}) {
  const name = (id?: string) => envelope.recipients.find((r) => r.id === id)?.name;
  const shown = events.filter((e) => e.action !== 'envelope.updated');
  return (
    <Card>
      <CardHeader
        title="Timeline"
        description="Every step, in a tamper-evident log."
        action={<ChainBadge valid={chainValid} />}
      />
      <ol className="relative px-5 py-4">
        {shown
          .slice()
          .reverse()
          .map((e) => {
            const who = name(e.recipientId);
            const reason =
              typeof e.data?.reason === 'string' && !e.action.startsWith('recipient.esign_')
                ? e.data.reason
                : null;
            const detail = eventDetail(e);
            return (
              <li
                key={e.seq}
                className="relative flex gap-3 pb-5 before:absolute before:top-4 before:bottom-0 before:left-[4.5px] before:w-px before:bg-line last:pb-0 last:before:hidden"
              >
                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px] ring-4 ring-surface',
                    DOT[actionTone(e.action)],
                  )}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-ink">
                    {who ? <span className="font-semibold">{who}: </span> : null}
                    {detail.label}
                    {e.data?.manual === true ? ' by the sender' : ''}
                  </p>
                  {reason ? <p className="text-muted">“{reason}”</p> : null}
                  {detail.note ? <p className="text-muted">{detail.note}</p> : null}
                  {detail.link ? (
                    <p className="text-muted">
                      {detail.link.prefix}{' '}
                      {slug ? (
                        <Link
                          href={`/dashboard/${slug}/envelopes/${encodeURIComponent(detail.link.envelopeId)}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {detail.link.title}
                        </Link>
                      ) : (
                        detail.link.title
                      )}
                    </p>
                  ) : null}
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    <LocalTime iso={e.at} />
                    {e.context?.ip ? ` · IP ${e.context.ip}` : ''}
                  </p>
                </div>
              </li>
            );
          })}
      </ol>
    </Card>
  );
}

function Hash({ value }: { value: string }) {
  return (
    <code
      className="block truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink"
      title={value}
    >
      {value}
    </code>
  );
}

export function CertificateCard({
  certificate,
  downloadHref,
  auditTrailHref,
  esignProviders = {},
}: {
  certificate: CertificateView;
  downloadHref: string;
  /** The audit trail as a PDF, the file the completed-copy email carries. */
  auditTrailHref?: string;
  /** The eSign provider of each recipient who signed with Aadhaar eSign, by recipient id. */
  esignProviders?: Record<string, { provider: string; sandbox?: boolean }>;
}) {
  return (
    <Card>
      <CardHeader
        title="Certificate"
        description="The evidence record behind the signatures."
        action={
          <div className="flex flex-wrap gap-2">
            {auditTrailHref ? (
              <Button asChild size="sm" variant="secondary">
                <a href={auditTrailHref}>
                  <Download aria-hidden className="h-4 w-4" />
                  Audit trail (PDF)
                </a>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="secondary">
              <a href={downloadHref}>
                <Download aria-hidden className="h-4 w-4" />
                JSON
              </a>
            </Button>
          </div>
        }
      />
      <div className="space-y-5 px-5 py-4 text-sm">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt className="text-muted">Envelope</dt>
          <dd className="min-w-0">
            <Hash value={certificate.envelopeId} />
          </dd>
          <dt className="text-muted">Completed</dt>
          <dd>
            {certificate.completedAt ? <LocalTime iso={certificate.completedAt} /> : 'Not yet'}
          </dd>
          <dt className="text-muted">Audit head</dt>
          <dd className="min-w-0">
            {certificate.auditHead ? <Hash value={certificate.auditHead} /> : '—'}
          </dd>
        </dl>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Fingerprint aria-hidden className="h-4 w-4 text-muted" /> Document fingerprints
            (SHA-256)
          </h3>
          <ul className="space-y-3">
            {certificate.documents.map((d) => (
              <li key={d.id}>
                <p className="font-medium">{d.name}</p>
                <dl className="mt-1 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                  <dt className="text-muted">Original</dt>
                  <dd className="min-w-0">
                    <Hash value={d.sha256} />
                  </dd>
                  <dt className="text-muted">Sealed</dt>
                  <dd className="min-w-0">
                    {d.sealedSha256 ? <Hash value={d.sealedSha256} /> : '—'}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 aria-hidden className="h-4 w-4 text-muted" /> Who did what
          </h3>
          <ul className="space-y-3">
            {certificate.recipients.map((r) => (
              <li key={r.id} className="rounded-lg border border-line p-3">
                <p className="font-medium">
                  {r.name}{' '}
                  <span className="text-muted">
                    {r.email ?? r.phone ?? ''} ·{' '}
                    {r.auth === 'aadhaar' && esignProviders[r.id]
                      ? authLabel({ auth: 'aadhaar', esign: esignProviders[r.id]! })
                      : (AUTH_LABELS[r.auth as keyof typeof AUTH_LABELS] ?? r.auth)}
                  </span>
                </p>
                {r.actions.length === 0 ? (
                  <p className="mt-1 text-muted">No actions yet.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-muted">
                    {r.actions.map((a, i) => (
                      <li key={i}>
                        <span className="text-ink">{actionLabel(a.action)}</span> ·{' '}
                        <LocalTime iso={a.at} />
                        {a.ip ? ` · ${a.ip}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
