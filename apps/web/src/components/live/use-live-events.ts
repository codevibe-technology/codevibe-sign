'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting';

export interface LiveEventsOptions {
  workspaceId: string;
  /** Only changes to this envelope count; every change in the workspace when left out. */
  envelopeId?: string;
  /** Called for each matching change, and after a reconnect, when changes may have been missed. */
  onChange: () => void;
}

const MAX_BACKOFF_MS = 30_000;

export const streamUrl = (workspaceId: string) =>
  `/api/live/workspaces/${encodeURIComponent(workspaceId)}/stream`;

/**
 * Subscribes to the workspace's live stream. EventSource reconnects by itself after a dropped
 * connection; when it gives up (the server answered with an error) this opens a new one with
 * growing delays, up to 30 seconds.
 */
export function useLiveEvents({ workspaceId, envelopeId, onChange }: LiveEventsOptions) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStatus('off');
      return;
    }
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let opened = false;
    let stopped = false;

    const connect = () => {
      source = new EventSource(streamUrl(workspaceId));
      source.addEventListener('ready', () => {
        if (opened) handler.current();
        opened = true;
        failures = 0;
        setStatus('live');
      });
      source.addEventListener('change', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { envelopeId?: unknown };
          if (!envelopeId || data.envelopeId === envelopeId) handler.current();
        } catch {
          // A malformed frame is ignored.
        }
      });
      source.addEventListener('resync', () => handler.current());
      source.onerror = () => {
        if (stopped) return;
        setStatus('reconnecting');
        if (source?.readyState !== EventSource.CLOSED) return;
        source = null;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures);
        failures++;
        retry = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [workspaceId, envelopeId]);

  return status;
}
