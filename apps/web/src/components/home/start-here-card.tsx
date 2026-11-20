'use client';

import { Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAction } from '@/components/settings/use-action';
import { dismissStartHereAction } from '@/server/actions/workspace';

/** Points a new workspace at its sample draft: send it to yourself and sign it. */
export function StartHereCard({
  workspaceId,
  href,
}: {
  workspaceId: string;
  /** The sample draft in the send flow. */
  href: string;
}) {
  const [hidden, setHidden] = useState(false);
  const dismiss = useAction();
  if (hidden) return null;
  return (
    <Card className="relative mb-6 overflow-hidden border-accent/60" data-testid="start-here">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-nav text-accent">
          <Sparkles aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 pr-8 sm:pr-0">
          <p className="eyebrow text-primary">Start here</p>
          <h2 className="mt-1 text-lg font-semibold">Sign your first document in a minute</h2>
          <p className="mt-0.5 text-sm text-muted">
            A sample agreement is ready with you as the signer and the boxes in place. Press Send,
            open the email, sign it, then download the sealed copy.
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href={href}>Open the sample</Link>
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="absolute top-2 right-2"
        pending={dismiss.pending}
        onClick={() => {
          setHidden(true);
          dismiss.run(() => dismissStartHereAction({ workspaceId }));
        }}
      >
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </Card>
  );
}
