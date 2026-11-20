'use client';

import { Check, Copy, Link2, PenLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { correctRecipientAction, shareLinkAction } from '@/server/actions/envelopes';

interface Target {
  workspaceId: string;
  envelopeId: string;
  recipient: { id: string; name: string; email: string | null; phone: string | null };
}

/**
 * "Get a link to share": a fresh signing link for an admin to pass on by hand. It is shown once,
 * kept only in this dialog, and gone when the dialog closes.
 */
export function ShareLinkButton({ workspaceId, envelopeId, recipient }: Target) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function close() {
    setUrl(null);
    setCopied(false);
    router.refresh();
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.error('Copy did not work here. Select the link and copy it yourself.');
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        pending={pending}
        onClick={() =>
          start(async () => {
            const result = await shareLinkAction({
              workspaceId,
              envelopeId,
              recipientId: recipient.id,
            });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            setUrl(result.data.url);
          })
        }
      >
        <Link2 aria-hidden className="h-4 w-4" />
        Get a link to share
      </Button>
      <DialogRoot open={url !== null} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent
          title={`Signing link for ${recipient.name}`}
          description="Shown once. Earlier links for this person no longer work."
        >
          <div className="space-y-4">
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-ink">
              Anyone with this link can sign as {recipient.name}. Send it only to them, for example
              on WhatsApp.
            </p>
            <Input
              readOnly
              aria-label="Signing link"
              value={url ?? ''}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Done
              </Button>
              <Button type="button" onClick={() => void copy()}>
                {copied ? (
                  <Check aria-hidden className="h-4 w-4" />
                ) : (
                  <Copy aria-hidden className="h-4 w-4" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}

/**
 * Correct a recipient who has not acted: name, email or phone. A new address of the person
 * whose turn it is gets a fresh invitation; a name change sends nothing unless asked.
 */
export function CorrectRecipientButton({
  workspaceId,
  envelopeId,
  recipient,
  current,
}: Target & { current: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(recipient.name);
  const [email, setEmail] = useState(recipient.email ?? '');
  const [phone, setPhone] = useState(recipient.phone ?? '');
  const [resend, setResend] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const addressChanged =
    email.trim().toLowerCase() !== (recipient.email ?? '').toLowerCase() ||
    phone.trim() !== (recipient.phone ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await correctRecipientAction({
        workspaceId,
        envelopeId,
        recipientId: recipient.id,
        name,
        email,
        ...(recipient.phone !== null || phone.trim() ? { phone } : {}),
        ...(resend && !addressChanged ? { resend: true } : {}),
      });
      if (!result.ok) {
        setError({ ...(result.field ? { field: result.field } : {}), message: result.error });
        return;
      }
      toast.success(
        result.data.invited
          ? `Corrected. A new invitation is on its way to ${email || name}.`
          : 'Corrected.',
      );
      setOpen(false);
      router.refresh();
    });
  }

  const fieldError = (key: string) => (error?.field?.endsWith(key) ? error.message : undefined);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <PenLine aria-hidden className="h-4 w-4" />
        Correct
      </Button>
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Correct ${recipient.name}`}
          description="Their role, order and fields stay. Links already sent to them stop working."
        >
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Name" error={fieldError('name')}>
              {(props) => (
                <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label="Email" error={fieldError('email')}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            {recipient.phone !== null ? (
              <Field
                label="Phone"
                hint="International format, for example +919876543210."
                error={fieldError('phone')}
              >
                {(props) => (
                  <Input {...props} value={phone} onChange={(e) => setPhone(e.target.value)} />
                )}
              </Field>
            ) : null}
            {current && addressChanged ? (
              <p className="text-sm text-muted">
                It is their turn, so the new address gets an invitation now.
              </p>
            ) : null}
            {current && !addressChanged ? (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={resend}
                  onChange={(e) => setResend(e.target.checked)}
                />
                Send a new invitation
              </label>
            ) : null}
            {error && !error.field ? <p className="text-sm text-danger">{error.message}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" pending={pending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
