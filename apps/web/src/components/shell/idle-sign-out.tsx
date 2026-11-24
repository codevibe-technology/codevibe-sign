'use client';

import { ShieldCheck } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { flushBeforeSignOut } from '@/lib/before-sign-out';
import { formatCountdown, signInAfter } from '@/lib/idle-sign-out';
import {
  openSessionChannel,
  type SessionChannel,
  type SessionMessage,
  type SignOutReason,
} from '@/lib/session-sync';

/** What counts as someone using the page. Visibility is handled on its own. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
/** The most often one tab tells the others about activity. */
const BROADCAST_EVERY_MS = 5000;
/** Waits a little past the server's write interval, so the server's own check has passed. */
const TOUCH_SLACK_MS = 2000;

/** Tells the server the person is active. False once the server has ended the session. */
async function touchServer(): Promise<boolean> {
  try {
    const response = await fetch('/api/session/activity', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return response.status !== 401;
  } catch {
    // Offline for a moment: the next activity tries again; the server keeps its own time.
    return true;
  }
}

export interface IdleSignOutProps {
  idleSeconds: number;
  warningSeconds: number;
  /** The server's least interval between activity writes. */
  touchSeconds: number;
  signOut?: () => Promise<unknown>;
  navigate?: (url: string) => void;
  touch?: () => Promise<boolean>;
  channel?: (onMessage: (message: SessionMessage) => void) => SessionChannel;
}

/**
 * Signs the person out of the app after `idleSeconds` with no use of any open tab, after a
 * warning that counts down the last `warningSeconds`. Activity is shared between tabs, and
 * reported to the server (at most once per `touchSeconds`) so work that stays in the browser
 * keeps the session alive there too. Before signing out, pending saves are flushed.
 */
export function IdleSignOut({
  idleSeconds,
  warningSeconds,
  touchSeconds,
  signOut = () => authClient.signOut(),
  navigate = (url) => window.location.assign(url),
  touch = touchServer,
  channel: connect = openSessionChannel,
}: IdleSignOutProps) {
  const idleMs = idleSeconds * 1000;
  const warningMs = warningSeconds * 1000;
  const touchMs = touchSeconds * 1000 + TOUCH_SLACK_MS;
  const [left, setLeft] = useState<number | null>(null);

  const lastActivity = useRef(Date.now());
  const lastBroadcast = useRef(0);
  const lastTouch = useRef(Date.now());
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warning = useRef(false);
  const ended = useRef(false);
  const channel = useRef<SessionChannel | null>(null);

  const deps = useRef({ signOut, navigate, touch });
  deps.current = { signOut, navigate, touch };

  const end = useCallback(async (reason: SignOutReason, told = false) => {
    if (ended.current) return;
    ended.current = true;
    if (trailing.current) clearTimeout(trailing.current);
    await flushBeforeSignOut();
    if (!told) {
      await deps.current.signOut().catch(() => undefined);
      channel.current?.post({ type: 'signed-out', reason });
    }
    deps.current.navigate(signInAfter(reason, window.location.pathname + window.location.search));
  }, []);

  /** Shows, updates or hides the warning; true once the time is up and sign-out started. */
  const check = useCallback((): boolean => {
    if (ended.current) return true;
    const remaining = lastActivity.current + idleMs - Date.now();
    if (remaining <= 0) {
      void end('idle');
      return true;
    }
    warning.current = remaining <= warningMs;
    setLeft(warning.current ? remaining : null);
    return false;
  }, [end, idleMs, warningMs]);

  const report = useCallback(
    (force: boolean) => {
      const wait = lastTouch.current + touchMs - Date.now();
      if (!force && wait > 0) {
        trailing.current ??= setTimeout(() => {
          trailing.current = null;
          report(false);
        }, wait);
        return;
      }
      if (trailing.current) {
        clearTimeout(trailing.current);
        trailing.current = null;
      }
      lastTouch.current = Date.now();
      void deps.current.touch().then((alive) => {
        if (!alive) void end('ended');
      });
    },
    [end, touchMs],
  );

  const active = useCallback(
    (at: number, origin: 'here' | 'other-tab', force = false) => {
      if (ended.current || at <= lastActivity.current) return;
      lastActivity.current = at;
      check();
      if (origin === 'other-tab') return;
      if (force || at - lastBroadcast.current >= BROADCAST_EVERY_MS) {
        lastBroadcast.current = at;
        channel.current?.post({ type: 'activity', at });
      }
      report(force);
    },
    [check, report],
  );

  useEffect(() => {
    channel.current = connect((message) => {
      if (message.type === 'activity') active(message.at, 'other-tab');
      else void end(message.reason, true);
    });
    // While the warning shows, only "Stay signed in" keeps the session: a mouse brushed in
    // passing is not someone choosing to stay.
    const ambient = () => {
      if (warning.current || check()) return;
      active(Date.now(), 'here');
    };
    const visible = () => {
      if (document.visibilityState === 'visible') ambient();
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, ambient, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', visible);
    const tick = setInterval(check, 1000);
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, ambient, { capture: true });
      }
      document.removeEventListener('visibilitychange', visible);
      clearInterval(tick);
      if (trailing.current) clearTimeout(trailing.current);
      channel.current?.close();
      channel.current = null;
    };
  }, [active, check, connect, end]);

  const stay = () => active(Math.max(Date.now(), lastActivity.current + 1), 'here', true);

  return (
    // Closing in any way other than "Sign out" (the button, Escape) means staying.
    <AlertDialog.Root
      open={left !== null}
      onOpenChange={(open) => {
        if (!open) stay();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-[#0D1B2A]/50" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[61] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line border-t-[3px] border-t-accent bg-surface p-6 shadow-[0_24px_64px_rgb(13_27_42/0.28)] focus:outline-none">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck aria-hidden className="h-6 w-6" />
          </div>
          <AlertDialog.Title className="font-display text-lg leading-snug font-semibold">
            You&rsquo;ll be signed out in{' '}
            <span className="tabular-nums">{formatCountdown(left ?? warningMs)}</span> for your
            security
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-sm text-muted">
            Nobody has used Codevibe Sign here for a while. Stay signed in to carry on where you
            are; after you sign in again you come back to this page.
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" onClick={() => void end('chosen')}>
                Sign out
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button autoFocus>Stay signed in</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
