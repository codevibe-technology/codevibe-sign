/** What one open tab of the app tells the others about the shared session. */
export type SessionMessage =
  | { type: 'activity'; at: number }
  | { type: 'signed-out'; reason: SignOutReason };

/** Idle time ran out, the server ended the session, or the person chose to sign out. */
export type SignOutReason = 'idle' | 'ended' | 'chosen';

const REASONS: readonly string[] = ['idle', 'ended', 'chosen'];

export interface SessionChannel {
  post(message: SessionMessage): void;
  close(): void;
}

const CHANNEL = 'cvs.session';
const STORAGE_KEY = 'cvs.session-sync';

function parse(value: unknown): SessionMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<SessionMessage> & { at?: unknown; reason?: unknown };
  if (message.type === 'activity' && typeof message.at === 'number') {
    return { type: 'activity', at: message.at };
  }
  if (message.type === 'signed-out' && typeof message.reason === 'string') {
    if (REASONS.includes(message.reason)) {
      return { type: 'signed-out', reason: message.reason as SignOutReason };
    }
  }
  return null;
}

/**
 * Connects the app's open tabs, so activity in one keeps all of them signed in and a sign-out
 * in one signs out every one. Uses a BroadcastChannel, or storage events where there is none.
 * A tab never hears its own messages.
 */
export function openSessionChannel(onMessage: (message: SessionMessage) => void): SessionChannel {
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const message = parse(event.data);
      if (message) onMessage(message);
    };
    return { post: (message) => channel.postMessage(message), close: () => channel.close() };
  }
  const listener = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const message = parse(JSON.parse(event.newValue));
      if (message) onMessage(message);
    } catch {
      // Something else wrote the key; not a message.
    }
  };
  window.addEventListener('storage', listener);
  return {
    post(message) {
      try {
        // The nonce makes a repeat of the same message still a change other tabs hear.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...message, nonce: Math.random() }));
      } catch {
        // Storage is off (private mode, policy): each tab keeps its own time.
      }
    },
    close: () => window.removeEventListener('storage', listener),
  };
}

/** Tells the app's other open tabs that this browser has signed out, so they follow. */
export function announceSignOut(reason: SignOutReason): void {
  const channel = openSessionChannel(() => undefined);
  channel.post({ type: 'signed-out', reason });
  channel.close();
}
