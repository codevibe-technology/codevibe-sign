'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { voidEnvelopesAction } from '@/server/actions/envelopes';

/**
 * Asks why, then withdraws one or more envelopes. Recipients already invited are told, with the
 * reason, and their links stop working.
 */
export function VoidDialog({
  workspaceId,
  envelopes,
  open,
  onOpenChange,
  onDone,
}: {
  workspaceId: string;
  envelopes: { id: string; title: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (voided: string[]) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const one = envelopes.length === 1;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setError('Say why, so the recipients know.');
      return;
    }
    start(async () => {
      const result = await voidEnvelopesAction({
        workspaceId,
        envelopeIds: envelopes.map((e) => e.id),
        reason,
      });
      if (!result.ok) {
        if (result.field === 'reason') setError(result.error);
        else toast.error(result.error);
        return;
      }
      const { voided, failed } = result.data;
      toast.success(one ? 'Envelope voided' : `${voided.length} envelopes voided`);
      if (failed.length > 0) {
        toast.warning(`${failed.length} could not be voided: ${failed[0]!.error}`);
      }
      setReason('');
      setError(undefined);
      onOpenChange(false);
      onDone?.(voided);
    });
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={one ? 'Void this envelope?' : `Void ${envelopes.length} envelopes?`}
        description={
          one
            ? `“${envelopes[0]?.title}” will stop: signing links stop working and everyone already invited is told why.`
            : 'They will stop: signing links stop working and everyone already invited is told why.'
        }
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label="Reason"
            hint="Recipients see this in the cancellation email; it is also kept in the audit log."
            error={error}
          >
            {(props) => (
              <Textarea
                {...props}
                value={reason}
                maxLength={1000}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError(undefined);
                }}
                placeholder="For example: the offer was sent with the wrong start date."
              />
            )}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" pending={pending}>
              {one ? 'Void envelope' : `Void ${envelopes.length}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
