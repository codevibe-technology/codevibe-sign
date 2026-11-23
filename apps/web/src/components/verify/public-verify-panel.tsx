'use client';

import {
  EarlierSignatures,
  type EarlierSignatureRow,
} from '@/components/verify/earlier-signatures';
import type {
  AuditAction,
  AuthMethod,
  RecipientRole,
  RecipientStatus,
} from '@codevibe_technology/sign-core';
import { FileText, Link2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useState, useTransition } from 'react';
import { FileDrop } from '@/components/envelopes/file-drop';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import {
  authLabel,
  RECIPIENT_STATUS_LABELS,
  RECIPIENT_STATUS_TONES,
  actionLabel,
  formatDateTime,
} from '@/lib/envelopes';
import { MAX_PDF_BYTES } from '@/lib/send-flow';

export interface PublicEvidence {
  title: string;
  documentName: string;
  sentAt: string | null;
  completedAt: string | null;
  recipients: {
    name: string;
    contact: string | null;
    role: RecipientRole;
    status: RecipientStatus;
    auth: AuthMethod;
    actedAt: string | null;
    esign?: { provider: string };
  }[];
  events: { seq: number; action: AuditAction; at: string; recipient: string | null }[];
  chain: { valid: boolean; head: string | null; events: number };
}

export interface PublicOutcome {
  valid: boolean;
  summary: string;
  reason: string | null;
  signer: string | null;
  signedAt: string | null;
  sha256: string;
  earlier?: EarlierSignatureRow[];
  fileName: string;
  evidence: PublicEvidence | null;
}

const ROLE_LABELS: Record<RecipientRole, string> = {
  signer: 'Signer',
  approver: 'Approver',
  viewer: 'Gets a copy',
};

type Check = (
  file: File,
) => Promise<{ ok: true; data: PublicOutcome } | { ok: false; error: string }>;

/** Posts the file to the check route; the server reads it in memory and keeps nothing. */
const postFile: Check = async (file) => {
  const form = new FormData();
  form.set('file', file);
  try {
    const response = await fetch('/api/verify', { method: 'POST', body: form });
    const body = (await response.json()) as
      | { ok: true; data: PublicOutcome }
      | { ok: false; error: string };
    return body;
  } catch {
    return {
      ok: false,
      error: 'The check did not reach the server. Check your connection and try again.',
    };
  }
};

/** Drop a PDF and see whether this site sealed it, who signed it and when. */
export function PublicVerifyPanel({ check = postFile }: { check?: Check }) {
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<PublicOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(file: File) {
    setOutcome(null);
    if (file.size > MAX_PDF_BYTES) {
      setError(
        `${file.name} is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB; sealed documents are smaller.`,
      );
      return;
    }
    setError(null);
    start(async () => {
      const result = await check(file);
      if (result.ok) setOutcome(result.data);
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-5">
      <FileDrop
        onFiles={(files) => run(files[0]!)}
        title={pending ? 'Checking the seal…' : 'Drop a signed PDF here'}
        hint="The file is sent to this site only to be checked, then dropped. It is not stored or logged."
        disabled={pending}
      />
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      {outcome ? <Result outcome={outcome} /> : null}
    </div>
  );
}

function Result({ outcome }: { outcome: PublicOutcome }) {
  const known = outcome.valid && outcome.evidence;
  const tone = !outcome.valid ? 'danger' : known ? 'success' : 'warning';
  const Icon = !outcome.valid ? ShieldAlert : known ? ShieldCheck : ShieldQuestion;
  return (
    <div className="space-y-5" role="status">
      <Card
        className={cn(
          'overflow-hidden',
          tone === 'success' && 'border-success/50',
          tone === 'danger' && 'border-danger/50',
          tone === 'warning' && 'border-warning/50',
        )}
      >
        <div
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
              className={cn(
                'font-display text-lg font-bold',
                tone === 'success' && 'text-success',
                tone === 'danger' && 'text-danger',
                tone === 'warning' && 'text-warning',
              )}
            >
              {!outcome.valid
                ? 'Not verified'
                : known
                  ? 'Seal is valid'
                  : 'Seal is valid, no record here'}
            </p>
            <p className="text-sm text-ink">
              {outcome.valid && !outcome.evidence
                ? 'The seal is intact and was made by this site, but no envelope with this exact file was found. It may have been sealed by an earlier install or a copy of the database that is gone.'
                : outcome.summary}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 text-sm">
          <dt className="text-muted">File</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted" />
            <span className="truncate">{outcome.fileName}</span>
          </dd>
          {outcome.evidence ? (
            <>
              <dt className="text-muted">Envelope</dt>
              <dd className="min-w-0 break-words">
                {outcome.evidence.title}
                <span className="text-muted"> · {outcome.evidence.documentName}</span>
              </dd>
            </>
          ) : null}
          {outcome.signer ? (
            <>
              <dt className="text-muted">Sealed by</dt>
              <dd>{outcome.signer}</dd>
            </>
          ) : null}
          {outcome.signedAt ? (
            <>
              <dt className="text-muted">Sealed at</dt>
              <dd>{formatDateTime(outcome.signedAt)}</dd>
            </>
          ) : null}
          <EarlierSignatures signatures={outcome.earlier ?? []} />
          <dt className="text-muted">SHA-256</dt>
          <dd className="min-w-0">
            <code className="block font-mono text-xs break-all">{outcome.sha256}</code>
          </dd>
        </dl>
      </Card>

      {outcome.evidence ? <Evidence evidence={outcome.evidence} /> : null}
    </div>
  );
}

function Evidence({ evidence }: { evidence: PublicEvidence }) {
  return (
    <>
      <Card>
        <div className="border-b border-line px-5 py-4">
          <p className="eyebrow mb-1">Signers</p>
          <h2 className="text-[16px] leading-6 font-semibold text-ink">Who took part, and when</h2>
        </div>
        <ul className="divide-y divide-line">
          {evidence.recipients.map((r, index) => (
            <li
              key={`${r.name}-${index}`}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">{r.name}</p>
                <p className="text-muted">
                  {[ROLE_LABELS[r.role], r.contact, r.role === 'viewer' ? null : authLabel(r)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <Badge tone={RECIPIENT_STATUS_TONES[r.status]}>
                  {RECIPIENT_STATUS_LABELS[r.status]}
                </Badge>
                {r.actedAt ? <span className="text-muted">{formatDateTime(r.actedAt)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="eyebrow mb-1">Audit trail</p>
            <h2 className="text-[16px] leading-6 font-semibold text-ink">
              {evidence.chain.events} recorded steps
            </h2>
          </div>
          <Badge tone={evidence.chain.valid ? 'success' : 'danger'}>
            {evidence.chain.valid ? 'Chain intact' : 'Chain broken'}
          </Badge>
        </div>
        <div className="px-5 py-4 text-sm">
          <p className="flex items-start gap-2 text-muted">
            <Link2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {evidence.chain.valid
              ? 'Each step carries a SHA-256 hash of the one before it. Every hash was recomputed and matches, so no step was changed, removed or added afterwards.'
              : 'A step does not match the hash recorded for it. Contact the sender before relying on this trail.'}
          </p>
          {evidence.chain.head ? (
            <p className="mt-2 text-muted">
              Chain head{' '}
              <code className="font-mono text-xs break-all text-ink">{evidence.chain.head}</code>
            </p>
          ) : null}
        </div>
        <ol className="border-t border-line px-5 py-3 text-sm">
          {evidence.events.map((e) => (
            <li
              key={e.seq}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 py-1.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]"
            >
              <span className="font-mono text-xs leading-5 text-muted">{e.seq}</span>
              <span className="min-w-0 text-ink">
                {actionLabel(e.action)}
                {e.recipient ? <span className="text-muted"> · {e.recipient}</span> : null}
              </span>
              <span className="col-start-2 text-muted sm:col-start-auto sm:text-right">
                {formatDateTime(e.at)}
              </span>
            </li>
          ))}
        </ol>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Times are shown in your browser&rsquo;s time zone. Email addresses and phone numbers are
          partly hidden.
        </p>
      </Card>
    </>
  );
}
