'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { setPublicRecordsAction } from '@/server/actions/public-records';
import { useAction } from './use-action';

export function PublicRecordsForm({
  workspaceId,
  enabled: initial,
}: {
  workspaceId: string;
  enabled: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial);
  const { pending, run } = useAction();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    run(() => setPublicRecordsAction({ workspaceId, enabled }), {
      success: enabled ? 'Public records turned on' : 'Public records turned off',
      onSuccess: () => setSaved(enabled),
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Public records"
          description="Each completed document gets a record page that the QR code on its certificate opens. It shows the seal status, who signed and the audit trail, never the document."
        />
        <CardBody className="space-y-3">
          <label className="flex items-start gap-3 text-[15px] text-ink">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <span className="font-semibold">Give completed documents a public record</span>
              <span className="block text-sm text-muted">
                Email addresses are partly hidden there, and IP addresses and devices are not shown.
                A sender can turn off the record of a single envelope.
              </span>
            </span>
          </label>
          <p className="text-sm text-muted" data-testid="records-now">
            {saved
              ? 'Record pages are on. Certificates of documents completed from now on carry a QR code.'
              : 'Record pages are off. Existing record links say the record is not available, and new certificates carry no QR code.'}
          </p>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={pending} disabled={enabled === saved}>
            Save
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
