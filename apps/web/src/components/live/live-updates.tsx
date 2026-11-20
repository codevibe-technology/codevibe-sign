'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { useLiveEvents, type LiveStatus } from './use-live-events';

export interface LiveUpdatesProps {
  workspaceId: string;
  /** Refresh only for changes to this envelope; for any change in the workspace when left out. */
  envelopeId?: string;
  debounceMs?: number;
}

/**
 * Keeps a server-rendered page current: refreshes it when the server reports a change it
 * shows, a burst of changes making one refresh. A hidden tab refreshes when it is shown
 * again. Renders a small Live / Reconnecting label.
 */
export function LiveUpdates({ workspaceId, envelopeId, debounceMs = 300 }: LiveUpdatesProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const refresh = useCallback(() => {
    if (document.visibilityState === 'hidden') {
      pending.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => routerRef.current.refresh(), debounceMs);
  }, [debounceMs]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !pending.current) return;
      pending.current = false;
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const status = useLiveEvents({
    workspaceId,
    ...(envelopeId ? { envelopeId } : {}),
    onChange: refresh,
  });
  return <LiveIndicator status={status} />;
}

export function LiveIndicator({ status }: { status: LiveStatus }) {
  if (status !== 'live' && status !== 'reconnecting') return null;
  const live = status === 'live';
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"
      title={live ? 'This page updates by itself' : 'Trying to reconnect for live updates'}
    >
      <span
        aria-hidden
        className={cn('h-2 w-2 rounded-full', live ? 'bg-success' : 'bg-line-strong')}
      />
      {live ? 'Live' : 'Reconnecting'}
    </span>
  );
}
