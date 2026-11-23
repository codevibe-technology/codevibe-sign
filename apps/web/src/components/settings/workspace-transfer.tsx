'use client';

import { ArrowRightLeft, History } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DialogClose, DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { LocalTime } from '@/components/ui/local-time';
import { describeTransferStep, type TransferStep } from '@/lib/transfers';
import { cancelTransferAction, startTransferAction } from '@/server/actions/transfers';
import { useAction } from './use-action';

export interface PendingTransferView {
  toEmail: string;
  /** ISO time. */
  expiresAt: string;
  previousOwnerStays: boolean;
}

const MOVES = [
  'Documents, templates, members, API keys and webhooks move with it.',
  'The address stays the same, so links and integrations keep working.',
  'It counts against their plan from then on.',
];
const STAYS = [
  'Invoices already issued, eSign credits and your subscription stay with your account.',
  'Billing admins become members, since what they paid for stays with you.',
];

/**
 * Transfer ownership and its history, on the workspace settings page. Only the person whose
 * account holds the workspace can offer it; everyone who opens the page sees the history.
 */
export function WorkspaceTransfer({
  workspace,
  canTransfer,
  holderName,
  pending,
  members,
  history,
}: {
  workspace: { id: string; slug: string; name: string };
  canTransfer: boolean;
  /** Who holds the account, for people who cannot transfer. */
  holderName: string | null;
  pending: PendingTransferView | null;
  /** People who could take it over: members and open invitations, never the holder. */
  members: { email: string; name: string }[];
  history: TransferStep[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [leave, setLeave] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [offering, startOffer] = useTransition();
  const [offerError, setOfferError] = useState<string>();
  const cancel = useAction();

  function review() {
    if (!email.trim()) {
      setOfferError('Enter the email of the person who should take over');
      return;
    }
    setOfferError(undefined);
    setConfirming(true);
  }

  // A plan limit here is the new owner's, so it is shown in place rather than as an upgrade
  // prompt for this workspace.
  function offer() {
    startOffer(async () => {
      const result = await startTransferAction({ workspaceId: workspace.id, email, leave });
      if (!result.ok) {
        setOfferError(result.error);
        return;
      }
      setConfirming(false);
      setEmail('');
      toast.success(`Transfer offered to ${result.data.toEmail}. They have 7 days to accept.`);
      router.refresh();
    });
  }

  function withdraw() {
    cancel.run(() => cancelTransferAction({ workspaceId: workspace.id }), {
      onSuccess: () => {
        setCancelling(false);
        toast.success('Transfer cancelled. Nothing has changed.');
        router.refresh();
      },
    });
  }

  return (
    <>
      <Card data-testid="workspace-transfer">
        <CardHeader
          title="Transfer ownership"
          description="Move this workspace to someone else's account. They take over its plan and billing."
        />
        <CardBody className="space-y-4">
          {pending ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/50 bg-accent-soft px-4 py-3"
              data-testid="transfer-pending"
            >
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-ink">
                  Offered to {pending.toEmail}. Waiting for them to accept.
                </p>
                <p className="mt-0.5 text-muted">
                  Expires <LocalTime iso={pending.expiresAt} format="day" />.{' '}
                  {pending.previousOwnerStays
                    ? 'You stay on as an admin.'
                    : 'You leave the workspace when it moves.'}
                </p>
              </div>
              {canTransfer ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCancelling(true)}
                >
                  Cancel transfer
                </Button>
              ) : null}
            </div>
          ) : canTransfer ? (
            <form
              noValidate
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                review();
              }}
            >
              <Field
                label="New owner's email"
                hint="Someone already in this workspace, or invited to it. Invite them from Team first if they are not."
                error={confirming ? undefined : offerError}
              >
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    list="transfer-candidates"
                    autoComplete="off"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setOfferError(undefined);
                    }}
                  />
                )}
              </Field>
              <datalist id="transfer-candidates">
                {members.map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.name}
                  </option>
                ))}
              </datalist>
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                  checked={leave}
                  onChange={(e) => setLeave(e.target.checked)}
                />
                <span>
                  Leave the workspace when it moves
                  <span className="block text-[13px] text-muted">
                    Otherwise you stay on as an admin.
                  </span>
                </span>
              </label>
              <Button type="submit" variant="secondary">
                <ArrowRightLeft aria-hidden className="h-4 w-4" />
                Transfer workspace
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">
              Only {holderName ?? 'the account owner'}, whose plan this workspace is on, can
              transfer it.
            </p>
          )}
        </CardBody>
      </Card>

      <Card data-testid="transfer-history">
        <CardHeader
          title="Ownership history"
          description="Every transfer offered, accepted, declined, cancelled or expired."
        />
        <CardBody>
          {history.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <History aria-hidden className="h-4 w-4" />
              This workspace has never changed hands.
            </p>
          ) : (
            <ol className="space-y-3">
              {history.map((step) => (
                <li key={step.id} className="border-l-2 border-line-strong pl-3 text-sm">
                  <p className="text-ink">{describeTransferStep(step)}</p>
                  <p className="text-[13px] text-muted">
                    <LocalTime iso={step.createdAt} />
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <DialogRoot open={confirming} onOpenChange={setConfirming}>
        {confirming ? (
          <DialogContent
            title={`Offer ${workspace.name} to ${email.trim()}?`}
            description="Nothing moves until they accept. You can cancel until then."
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Summary title="Moves with the workspace" lines={MOVES} />
                <Summary title="Stays with you" lines={STAYS} />
              </div>
              <p className="text-[13.5px] text-ink">
                {leave
                  ? 'You will leave the workspace once it moves.'
                  : 'You will stay on as an admin once it moves.'}{' '}
                The offer expires in 7 days.
              </p>
              {offerError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger"
                  data-testid="transfer-error"
                >
                  {offerError}{' '}
                  {/not in this workspace/.test(offerError) ? (
                    <Link
                      className="font-semibold underline"
                      href={`/dashboard/${workspace.slug}/settings/team`}
                    >
                      Open Team
                    </Link>
                  ) : null}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Back
                  </Button>
                </DialogClose>
                <Button type="button" onClick={offer} pending={offering}>
                  {offering ? 'Sending offer…' : 'Send transfer offer'}
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </DialogRoot>

      <DialogRoot open={cancelling} onOpenChange={setCancelling}>
        {cancelling && pending ? (
          <DialogContent
            title="Cancel the transfer?"
            description={`${pending.toEmail} will be told the offer is withdrawn. The workspace stays yours.`}
          >
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Keep the offer
                </Button>
              </DialogClose>
              <Button type="button" variant="danger" onClick={withdraw} pending={cancel.pending}>
                Cancel transfer
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </DialogRoot>
    </>
  );
}

function Summary({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg bg-surface-2 px-4 py-3">
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink">{title}</h3>
      <ul className="space-y-1 text-[13px] text-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
