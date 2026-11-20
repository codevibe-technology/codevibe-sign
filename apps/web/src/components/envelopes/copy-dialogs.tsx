'use client';

import { FilePen, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { recallEnvelopeAction, reviseEnvelopeAction } from '@/server/actions/envelopes';

const draftHref = (slug: string, draftId: string) =>
  `/w/${slug}/envelopes/new?draft=${encodeURIComponent(draftId)}`;

/**
 * Recall and edit: voids the sent envelope and opens a draft copy in the send flow. Anyone who
 * already signed signs again.
 */
export function RecallButton({
  slug,
  workspaceId,
  envelope,
}: {
  slug: string;
  workspaceId: string;
  envelope: { id: string; title: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await recallEnvelopeAction({
        workspaceId,
        envelopeId: envelope.id,
        ...(note.trim() ? { note } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Recalled. Correct the copy and send it again.');
      setOpen(false);
      router.push(draftHref(slug, result.data.draftId));
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FilePen aria-hidden className="h-4 w-4" />
        Recall and edit
      </Button>
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Recall and edit?"
          description={`“${envelope.title}” is withdrawn and a copy opens for you to correct and send again.`}
        >
          <form onSubmit={submit} className="space-y-4" noValidate>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
              <li>Signing links stop working and everyone already invited is told.</li>
              <li>Anyone who already signed will need to sign again.</li>
              <li>The copy keeps the documents, people, fields and settings.</li>
            </ul>
            <Field
              label="Note (optional)"
              hint="Added to the reason “Recalled to correct” in the cancellation email."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={note}
                  maxLength={900}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="For example: the joining date was wrong."
                />
              )}
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <Button type="submit" pending={pending}>
                Recall and edit
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </>
  );
}

/** Revise and resend: copies the declined envelope to a draft and opens it in the send flow. */
export function ReviseButton({
  slug,
  workspaceId,
  envelopeId,
}: {
  slug: string;
  workspaceId: string;
  envelopeId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      pending={pending}
      onClick={() =>
        start(async () => {
          const result = await reviseEnvelopeAction({ workspaceId, envelopeId });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.push(draftHref(slug, result.data.draftId));
        })
      }
    >
      <RotateCcw aria-hidden className="h-4 w-4" />
      Revise and resend
    </Button>
  );
}
