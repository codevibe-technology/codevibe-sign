'use client';

import { Ban } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RemindButton } from './remind-button';
import { VoidDialog } from './void-dialog';

/** The header actions on an envelope: remind whoever is next and void, as the role allows. */
export function EnvelopeActions({
  workspaceId,
  envelope,
  canRemind,
  canVoid,
}: {
  workspaceId: string;
  envelope: { id: string; title: string };
  canRemind: boolean;
  canVoid: boolean;
}) {
  const router = useRouter();
  const [voiding, setVoiding] = useState(false);
  return (
    <>
      {canRemind ? (
        <RemindButton
          workspaceId={workspaceId}
          envelopeId={envelope.id}
          label="Remind"
          size="md"
          success="Reminder sent to everyone whose turn it is"
        />
      ) : null}
      {canVoid ? (
        <Button variant="secondary" className="text-danger" onClick={() => setVoiding(true)}>
          <Ban aria-hidden className="h-4 w-4" />
          Void
        </Button>
      ) : null}
      <VoidDialog
        workspaceId={workspaceId}
        envelopes={[envelope]}
        open={voiding}
        onOpenChange={setVoiding}
        onDone={() => router.refresh()}
      />
    </>
  );
}
