'use client';

import { ArrowUpRight, Gauge } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { LocalTime } from '@/components/ui/local-time';
import { authClient } from '@/lib/auth-client';
import { acceptTransferAction, declineTransferAction } from '@/server/actions/transfers';

/** How the person shows it is them: their password, a sign-in just now, or a new sign-in. */
export type TransferConfirm = 'password' | 'recent-sign-in' | 'sign-in-again';

const MOVES = [
  'Documents, templates, members, API keys and webhooks',
  'The same address, so links and integrations keep working',
];
const STAYS = [
  'Invoices already issued, eSign credits and the subscription',
  'Billing admins become members; you choose new ones',
];

export function AcceptTransfer({
  transfer,
  confirm,
  room,
  signInHref,
}: {
  transfer: {
    id: string;
    workspaceName: string;
    fromName: string;
    expiresAt: string;
    previousOwnerStays: boolean;
  };
  confirm: TransferConfirm;
  /** Set when the person's plan has no room for another workspace yet. */
  room: { message: string; upgradePath: string } | null;
  signInHref: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [needsSignIn, setNeedsSignIn] = useState(confirm === 'sign-in-again');
  const [pending, start] = useTransition();
  const [declining, startDecline] = useTransition();

  function accept(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    start(async () => {
      const result = await acceptTransferAction({
        transferId: transfer.id,
        ...(confirm === 'password' ? { password } : {}),
      });
      if (result.ok) {
        toast.success(`${transfer.workspaceName} is now yours`);
        router.push(`/dashboard/${result.data.slug}`);
        return;
      }
      if (result.field === 'reauth') setNeedsSignIn(true);
      setError(result.error);
    });
  }

  function decline() {
    startDecline(async () => {
      const result = await declineTransferAction({ transferId: transfer.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`You declined. ${transfer.fromName} has been told.`);
      router.refresh();
    });
  }

  async function signInAgain() {
    await authClient.signOut();
    window.location.assign(signInHref);
  }

  return (
    <form onSubmit={accept} noValidate className="space-y-5" data-testid="accept-transfer">
      <div className="grid gap-3 sm:grid-cols-2">
        <List title="Comes with it" lines={MOVES} />
        <List title={`Stays with ${transfer.fromName}`} lines={STAYS} />
      </div>
      <p className="text-[13.5px] text-muted">
        {transfer.previousOwnerStays
          ? `${transfer.fromName} stays on as an admin.`
          : `${transfer.fromName} leaves the workspace.`}{' '}
        The offer is open until <LocalTime iso={transfer.expiresAt} format="day" />.
      </p>

      {room ? (
        <div
          role="alert"
          data-testid="transfer-upgrade"
          className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-accent/50 bg-accent-soft px-4 py-3"
        >
          <Gauge aria-hidden className="h-5 w-5 shrink-0 text-ink" />
          <p className="min-w-0 flex-1 basis-56 text-sm font-semibold text-ink">{room.message}</p>
          <Link
            href={room.upgradePath}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-ink hover:bg-primary-hover"
          >
            Upgrade
            <ArrowUpRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      ) : needsSignIn ? (
        <div
          className="rounded-lg border border-line-strong bg-surface-2 px-4 py-3 text-sm"
          data-testid="transfer-reauth"
        >
          <p className="font-semibold text-ink">Sign in again to confirm it is you</p>
          <p className="mt-0.5 text-muted">
            Taking over a workspace needs a sign-in from the last 15 minutes. You come back here
            afterwards.
          </p>
          <Button type="button" className="mt-3" onClick={signInAgain}>
            Sign in again
          </Button>
        </div>
      ) : confirm === 'password' ? (
        <Field
          label="Your password"
          hint="To confirm it is you before the workspace moves."
          error={error}
        >
          {(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(undefined);
              }}
            />
          )}
        </Field>
      ) : (
        <p className="text-[13.5px] text-muted">
          You signed in a few minutes ago, which confirms it is you.
        </p>
      )}

      {error && confirm !== 'password' ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={decline} pending={declining}>
          Decline
        </Button>
        <Button type="submit" pending={pending} disabled={room !== null || needsSignIn}>
          {pending ? 'Moving the workspace…' : `Accept ${transfer.workspaceName}`}
        </Button>
      </div>
    </form>
  );
}

function List({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg bg-surface-2 px-4 py-3">
      <h2 className="mb-1.5 text-[13px] font-semibold text-ink">{title}</h2>
      <ul className="space-y-1 text-[13px] text-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
