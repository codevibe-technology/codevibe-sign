import { LIVE_CHANNEL, decodeChange, type LiveChange } from './events';

/** What a subscriber hears: a change in its workspace, or `resync` after a missed stretch. */
export type LiveSignal = { type: 'change'; change: LiveChange } | { type: 'resync' };

/**
 * Starts listening on `channel`: calls `onMessage` for every payload and `onListen` each time
 * the listening connection is (re)established. postgres.js `sql.listen` has this shape.
 */
export type Listen = (
  channel: string,
  onMessage: (payload: string) => void,
  onListen: () => void,
) => Promise<unknown>;

export interface LiveHub {
  /**
   * Subscribes to one workspace's changes. Resolves once the shared listener is ready, with the
   * function that unsubscribes. Rejects when the listener cannot start.
   */
  subscribe(workspaceId: string, onSignal: (signal: LiveSignal) => void): Promise<() => void>;
  /** Subscribers right now, for tests and diagnostics. */
  size(): number;
}

/**
 * One listener per process, shared by every open stream, fanned out in memory by workspace. A
 * subscriber only ever receives changes of the workspace it subscribed to.
 */
export function createLiveHub(listen: Listen): LiveHub {
  const subscribers = new Map<string, Set<(signal: LiveSignal) => void>>();
  let started: Promise<unknown> | null = null;
  let listening = false;

  const deliver = (fns: Iterable<(signal: LiveSignal) => void>, signal: LiveSignal) => {
    for (const fn of fns) {
      try {
        fn(signal);
      } catch {
        // One broken stream must not stop the others.
      }
    }
  };

  const onMessage = (payload: string) => {
    const change = decodeChange(payload);
    if (!change) return;
    const fns = subscribers.get(change.workspaceId);
    if (fns) deliver([...fns], { type: 'change', change });
  };

  // postgres.js calls this again after it reconnects; NOTIFYs sent meanwhile are lost.
  const onListen = () => {
    if (listening) {
      deliver(
        [...subscribers.values()].flatMap((fns) => [...fns]),
        { type: 'resync' },
      );
    }
    listening = true;
  };

  const start = () => {
    started ??= listen(LIVE_CHANNEL, onMessage, onListen).catch((err: unknown) => {
      started = null;
      throw err;
    });
    return started;
  };

  return {
    async subscribe(workspaceId, onSignal) {
      await start();
      let fns = subscribers.get(workspaceId);
      if (!fns) {
        fns = new Set();
        subscribers.set(workspaceId, fns);
      }
      fns.add(onSignal);
      return () => {
        const current = subscribers.get(workspaceId);
        if (!current) return;
        current.delete(onSignal);
        if (current.size === 0) subscribers.delete(workspaceId);
      };
    },
    size: () => [...subscribers.values()].reduce((n, fns) => n + fns.size, 0),
  };
}
