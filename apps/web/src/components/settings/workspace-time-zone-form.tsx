'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { useHydrated } from '@/components/ui/use-hydrated';
import { zoneLabel, zoneName } from '@/lib/preferences';
import { setWorkspaceTimeZoneAction } from '@/server/actions/workspace';
import { TimeZoneSelect } from './time-zone-select';
import { useAction } from './use-action';

export function WorkspaceTimeZoneForm({
  workspaceId,
  timeZone,
  chosen,
}: {
  workspaceId: string;
  /** The zone in use: the workspace's own, or the install's default. */
  timeZone: string;
  /** False while the workspace still follows the install's default. */
  chosen: boolean;
}) {
  const [saved, setSaved] = useState(timeZone);
  const [zone, setZone] = useState(timeZone);
  const { pending, errors, run } = useAction();
  const hydrated = useHydrated();

  function submit(event: FormEvent) {
    event.preventDefault();
    run(() => setWorkspaceTimeZoneAction({ workspaceId, timeZone: zone }), {
      success: 'Time zone saved',
      onSuccess: () => setSaved(zone),
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Time zone"
          description="For the dates printed on signed documents and written in emails. On screen, everyone sees times in their own zone."
        />
        <CardBody className="space-y-3">
          <Field
            label="Time zone"
            hint={
              chosen
                ? 'The signing certificate always shows UTC next to this zone.'
                : 'This is the default here until you save one. The signing certificate always shows UTC next to it.'
            }
            error={errors.timeZone}
          >
            {(props) => <TimeZoneSelect {...props} value={zone} onChange={setZone} />}
          </Field>
          <p className="text-sm text-muted" data-testid="zone-now">
            Documents signed from now on are dated in{' '}
            {hydrated ? zoneLabel(saved) : zoneName(saved)}. Ones already signed keep their dates.
          </p>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={pending} disabled={zone === saved && chosen}>
            Save time zone
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
