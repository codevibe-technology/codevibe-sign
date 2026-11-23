'use client';

import { Check, Copy, FileCheck2, Fingerprint, Lock, PlugZap, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DialogClose, DialogContent, DialogRoot, SheetContent } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { LocalTime } from '@/components/ui/local-time';
import { formatInr } from '@/lib/billing/money';
import { cn } from '@/lib/cn';
import { ManagedBy } from '@/components/billing/managed-by';
import { planPagePath } from '@/lib/plans';
import {
  removeEsignCredentialsAction,
  saveEsignCredentialsAction,
  setEsignModeAction,
  testEsignConnectionAction,
} from '@/server/actions/esign';
import type { EsignOverview } from '@/server/esign/overview';
import type { EsignMode } from '@/server/esign/settings';
import { useAction } from './use-action';

const OUTCOMES: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  signed: { label: 'Signed', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  expired: { label: 'Expired', tone: 'warning' },
  failed: { label: 'Did not finish', tone: 'danger' },
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
        <code className="min-w-0 flex-1 px-1 text-[13px] break-all">{value}</code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? (
            <Check aria-hidden className="h-4 w-4" />
          ) : (
            <Copy aria-hidden className="h-4 w-4" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function ModeCard({
  selected,
  title,
  badge,
  children,
  footer,
  testId,
}: {
  selected: boolean;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId: string;
}) {
  return (
    <section
      data-testid={testId}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex flex-col rounded-xl border p-4',
        selected ? 'border-primary bg-primary-soft/50' : 'border-line-strong bg-surface',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {selected ? <Badge tone="primary">In use</Badge> : null}
        {badge}
      </div>
      <div className="mt-2 flex-1 space-y-2 text-sm text-muted">{children}</div>
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-2">{footer}</div> : null}
    </section>
  );
}

/**
 * Settings, Aadhaar eSign: whose provider account the workspace signs with, the prepaid
 * credits of the install's account, and the workspace's own account details, which can be
 * written and tried but never read back.
 */
export function EsignSettingsPanel({
  workspaceId,
  slug,
  overview,
  canManage = true,
  managedBy = null,
}: {
  workspaceId: string;
  slug: string;
  overview: EsignOverview;
  /** False for an admin who does not own the account: everything is shown, nothing can change. */
  canManage?: boolean;
  /** The account owner's name, for that admin. */
  managedBy?: string | null;
}) {
  const { settings, credits } = overview;
  const [sheet, setSheet] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const mode = useAction();
  const save = useAction();
  const remove = useAction();
  const test = useAction();
  const billingHref = `/dashboard/${slug}/settings/billing`;

  const choose = (next: EsignMode) =>
    mode.run(() => setEsignModeAction({ workspaceId, mode: next }), {
      success:
        next === 'own'
          ? 'Aadhaar eSign now uses your Leegality account'
          : 'Aadhaar eSign now uses prepaid credits',
    });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('workspaceId', workspaceId);
    save.run(() => saveEsignCredentialsAction(form), {
      success: 'Leegality account saved',
      onSuccess: () => {
        setSheet(false);
        setTestResult(null);
      },
    });
  }

  const price =
    overview.pricePaise === null
      ? 'Price coming soon'
      : `${formatInr(overview.pricePaise)} per eSign`;
  const platformOff = !overview.platformConfigured;

  return (
    <>
      {canManage ? null : (
        <ManagedBy owner={managedBy} what="Aadhaar eSign and its credits are set up once" />
      )}
      <fieldset disabled={!canManage} className="m-0 min-w-0 space-y-6 border-0 p-0">
        <Card>
          <CardHeader
            title="Aadhaar eSign"
            description="Ask a signer to sign with an Aadhaar one-time code through Leegality, a licensed eSign provider. Use it for documents a law requires to be signed; for most others the built-in signature is enough."
            action={
              overview.sandbox && settings.mode === 'platform' && overview.platformConfigured ? (
                <Badge tone="warning">Test mode</Badge>
              ) : undefined
            }
          />
          <CardBody className="space-y-4">
            {overview.blocked ? (
              <p
                role="status"
                data-testid="esign-blocked"
                className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-ink"
              >
                <span className="font-semibold">Sending with Aadhaar eSign is off. </span>
                {overview.blocked.message}
              </p>
            ) : (
              <p
                role="status"
                data-testid="esign-ready"
                className="flex items-center gap-2 rounded-lg border border-success/40 bg-success-soft px-4 py-3 text-sm text-ink"
              >
                <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-success" />
                Ready. Choose Aadhaar eSign as the identity check for a signer when you send.
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <ModeCard
                testId="esign-mode-platform"
                selected={settings.mode === 'platform'}
                title="Use Codevibe Sign's account"
                badge={platformOff ? <Badge>Coming soon</Badge> : undefined}
                footer={
                  <>
                    {overview.creditsRequired && !platformOff ? (
                      <Button asChild size="sm" variant="secondary">
                        <Link href={billingHref}>Buy credits</Link>
                      </Button>
                    ) : null}
                    {settings.mode !== 'platform' ? (
                      <Button size="sm" pending={mode.pending} onClick={() => choose('platform')}>
                        Use this
                      </Button>
                    ) : null}
                  </>
                }
              >
                {platformOff ? (
                  <p>
                    {overview.billingVisible
                      ? 'Not switched on yet. You will be able to buy prepaid credits here and use them straight away.'
                      : 'The operator of this server has not connected a Leegality account.'}
                  </p>
                ) : overview.creditsRequired ? (
                  <>
                    <p>Nothing to set up. Each completed eSign uses one prepaid credit.</p>
                    <dl className="grid grid-cols-2 gap-2 pt-1 text-ink">
                      <div className="rounded-lg border border-line bg-surface px-3 py-2">
                        <dt className="text-[12px] text-muted">Credits left</dt>
                        <dd className="font-display text-xl font-bold" data-testid="esign-credits">
                          {credits.available}
                        </dd>
                        {credits.reserved > 0 ? (
                          <dd className="text-[12px] text-muted">{credits.reserved} in use now</dd>
                        ) : null}
                        {overview.owed > 0 ? (
                          <dd
                            className="text-[12px] font-medium text-danger"
                            data-testid="esign-owed"
                          >
                            {overview.owed === 1 ? '1 eSign owed' : `${overview.owed} eSigns owed`}.
                            New credits pay for {overview.owed === 1 ? 'it' : 'them'} first.
                          </dd>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-line bg-surface px-3 py-2">
                        <dt className="text-[12px] text-muted">Price</dt>
                        <dd className="text-[15px] font-semibold" data-testid="esign-price">
                          {price}
                        </dd>
                        <dd className="text-[12px] text-muted">plus GST</dd>
                      </div>
                    </dl>
                    <p>
                      A credit is held when a signer starts and comes back if they do not finish.
                    </p>
                  </>
                ) : (
                  <p>Uses the Leegality account set up for this server. No credits are needed.</p>
                )}
              </ModeCard>

              <ModeCard
                testId="esign-mode-own"
                selected={settings.mode === 'own'}
                title="Use your own Leegality account"
                badge={
                  !overview.ownAllowed ? (
                    <Badge tone="accent">Cloud plan</Badge>
                  ) : settings.own.environment === 'sandbox' ? (
                    <Badge tone="warning">Sandbox</Badge>
                  ) : undefined
                }
                footer={
                  overview.ownAllowed ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setSheet(true)}>
                        <PlugZap aria-hidden className="h-4 w-4" />
                        {settings.own.configured ? 'Replace details' : 'Connect account'}
                      </Button>
                      {settings.own.configured ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          pending={test.pending}
                          onClick={() =>
                            test.run(() => testEsignConnectionAction({ workspaceId }), {
                              onSuccess: setTestResult,
                            })
                          }
                        >
                          Test connection
                        </Button>
                      ) : null}
                      {settings.own.configured && settings.mode !== 'own' ? (
                        <Button size="sm" pending={mode.pending} onClick={() => choose('own')}>
                          Use this
                        </Button>
                      ) : null}
                      {settings.own.configured ? (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                          Remove
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={planPagePath(slug)}>See the Cloud plan</Link>
                    </Button>
                  )
                }
              >
                {!overview.ownAllowed ? (
                  <p className="flex gap-2">
                    <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Part of the Cloud plan. Leegality then bills you directly and no credits are
                      used.
                      {settings.mode === 'own'
                        ? ' Your saved account is switched off until this workspace is on Cloud again.'
                        : ''}
                    </span>
                  </p>
                ) : settings.own.configured ? (
                  <>
                    <p>
                      Connected. Auth Token ending{' '}
                      <code className="rounded bg-surface-2 px-1 text-[13px] text-ink">
                        {settings.own.keyHint}
                      </code>
                      , {settings.own.environment === 'production' ? 'production' : 'sandbox'}.
                      Leegality bills you directly.
                    </p>
                    {settings.own.testedAt ? (
                      <p data-testid="esign-test-state">
                        {settings.own.testOk ? 'Last check passed ' : 'Last check failed '}
                        <LocalTime iso={settings.own.testedAt} format="relative" />.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>
                    Enter your Leegality API details. Leegality bills you directly and no credits
                    are used.
                  </p>
                )}
                {testResult ? (
                  <p
                    role="status"
                    className={cn('font-medium', testResult.ok ? 'text-success' : 'text-danger')}
                  >
                    {testResult.message}
                  </p>
                ) : null}
                {mode.errors.mode || mode.errors.credentials ? (
                  <p role="alert" className="text-danger">
                    {mode.errors.mode ?? mode.errors.credentials}
                  </p>
                ) : null}
              </ModeCard>
            </div>

            <p className="flex gap-2 text-[13px] text-muted">
              <Fingerprint aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              The signer types their Aadhaar number and one-time code on Leegality's page. Codevibe
              Sign never sees or stores an Aadhaar number.
            </p>
            <p className="flex gap-2 text-[13px] text-muted" data-testid="esign-standard-flow">
              <FileCheck2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Leegality places the Aadhaar signature where the Leegality workflow says; senders
                place no box and the signer fills in nothing. Everyone then gets the signed PDF,
                with the Aadhaar signature and the Codevibe Sign seal, and a separate certificate
                and audit trail PDF.{' '}
                <a
                  className="font-semibold text-primary hover:underline"
                  href="/docs/guides/aadhaar-leegality#set-the-signature-position"
                  target="_blank"
                  rel="noreferrer"
                >
                  Set the signature position
                </a>
              </span>
            </p>
          </CardBody>
        </Card>

        {overview.ownAllowed ? (
          <Card>
            <CardHeader
              title="Set up your Leegality workflow"
              description="Only for your own account. In Leegality, open the workflow whose ID you entered and set these."
            />
            <CardBody className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>Choose Aadhaar eSign as the signature type for the invitee.</li>
                <li>
                  Set the signature position for the invitee: Leegality places the Aadhaar signature
                  where the workflow says. Codevibe Sign sends the document as you approved it and
                  places no box; without a position Leegality signs at the bottom left of every
                  page.
                </li>
                <li>
                  Under the invitee's custom URLs and webhooks, paste the two addresses below and
                  choose webhook version 2.5.
                </li>
              </ol>
              <CopyRow label="Webhook and error webhook" value={overview.webhookUrl} />
              <CopyRow label="Redirect URL" value={overview.redirectUrl} />
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Recent Aadhaar eSigns" description="The latest 20, newest first." />
          {overview.usage.length ? (
            <ul className="divide-y divide-line" data-testid="esign-usage">
              {overview.usage.map((line) => {
                const outcome = line.outcome ? OUTCOMES[line.outcome] : null;
                return (
                  <li key={line.ref} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/${slug}/envelopes/${line.envelopeId}`}
                        className="block truncate font-medium text-ink hover:text-primary hover:underline"
                      >
                        {line.envelopeTitle ?? 'Envelope'}
                      </Link>
                      <p className="text-sm text-muted">
                        Started <LocalTime iso={line.startedAt} format="short" /> ·{' '}
                        {line.mode === 'own'
                          ? 'your Leegality account'
                          : line.billed
                            ? line.outcome === 'signed'
                              ? '1 credit used'
                              : line.outcome
                                ? 'credit returned'
                                : '1 credit held'
                            : "this server's account"}
                      </p>
                    </div>
                    {outcome ? (
                      <Badge tone={outcome.tone}>{outcome.label}</Badge>
                    ) : (
                      <Badge tone="primary">In progress</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-muted">
                Nothing yet. An eSign shows here when a signer starts one.
              </p>
            </CardBody>
          )}
        </Card>
      </fieldset>

      <DialogRoot
        open={sheet}
        onOpenChange={(next) => {
          setSheet(next);
          if (!next) save.clear();
        }}
      >
        <SheetContent
          title="Your Leegality account"
          description="From Leegality, Dashboard, API settings. The values are checked with Leegality, stored encrypted and never shown again."
        >
          <form onSubmit={submit} className="space-y-4" data-testid="esign-credentials-form">
            <Field
              label="Environment"
              hint="Sandbox signatures are for testing and have no legal effect."
              error={save.errors.environment}
            >
              {(props) => (
                <NativeSelect
                  {...props}
                  name="environment"
                  defaultValue={settings.own.environment ?? 'production'}
                >
                  <option value="production">Production</option>
                  <option value="sandbox">Sandbox</option>
                </NativeSelect>
              )}
            </Field>
            <Field label="Auth Token" error={save.errors.apiKey}>
              {(props) => (
                <Input
                  {...props}
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  placeholder={
                    settings.own.keyHint ? `Saved, ending ${settings.own.keyHint}` : undefined
                  }
                />
              )}
            </Field>
            <Field
              label="Private Salt"
              hint="Checks that a callback really comes from Leegality."
              error={save.errors.privateSalt}
            >
              {(props) => (
                <Input
                  {...props}
                  name="privateSalt"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              )}
            </Field>
            <Field
              label="Workflow ID"
              hint="The published workflow that asks for an Aadhaar eSign."
              error={save.errors.workflowId}
            >
              {(props) => (
                <Input
                  {...props}
                  name="workflowId"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              )}
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" pending={save.pending}>
                Check and save
              </Button>
            </div>
          </form>
        </SheetContent>
      </DialogRoot>

      <DialogRoot open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent
          title="Remove your Leegality account?"
          description="The saved details are deleted and Aadhaar eSign goes back to prepaid credits. Envelopes already signed are not affected."
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button
              variant="danger"
              pending={remove.pending}
              onClick={() =>
                remove.run(() => removeEsignCredentialsAction({ workspaceId }), {
                  success: 'Leegality account removed',
                  onSuccess: () => {
                    setConfirmRemove(false);
                    setTestResult(null);
                  },
                })
              }
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
