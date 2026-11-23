'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { HUMAN_CHECK_HEADER, humanCheckMessage } from '@/lib/human-check';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** How long a submit waits for the check to finish before it gives up. */
const WAIT_MS = 15_000;

interface TurnstileOptions {
  sitekey: string;
  action?: string;
  theme: 'light';
  size: 'flexible';
  appearance: 'interaction-only';
  'response-field': false;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start'));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Turnstile could not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface HumanCheckControl {
  /** Where the check shows itself when Cloudflare wants the visitor to click. */
  widget: ReactNode;
  /**
   * A token for one request: waits for the check to finish, or throws an Error with a
   * message to show. Resolves to null when the check is off.
   */
  token(): Promise<string | null>;
  /** Starts a fresh check; call it after every request, because a token works once. */
  reset(): void;
}

/** Headers that carry a token to `/api/auth/*`; none when the check is off. */
export const humanCheckHeaders = (token: string | null) =>
  token ? { fetchOptions: { headers: { [HUMAN_CHECK_HEADER]: token } } } : {};

/**
 * Cloudflare Turnstile in its managed, mostly invisible form: it decides in the background,
 * and only when it is unsure does it show a box to click. With no site key it renders
 * nothing and every token is null, so installs without Turnstile work as before.
 */
export function useHumanCheck(siteKey: string | null, action?: string): HumanCheckControl {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const current = useRef<string | null>(null);
  const waiting = useRef<((token: string | null, problem?: string) => void)[]>([]);
  /** Why the last check failed, until a new one starts. */
  const failure = useRef<string | null>(null);
  const loadFailed = useRef(false);

  const settle = useCallback((token: string | null, failure?: string) => {
    const pending = waiting.current;
    waiting.current = [];
    for (const done of pending) done(token, failure);
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current =
          api.render(container.current, {
            sitekey: siteKey,
            ...(action ? { action } : {}),
            theme: 'light',
            size: 'flexible',
            appearance: 'interaction-only',
            'response-field': false,
            callback: (token) => {
              current.current = token;
              failure.current = null;
              settle(token);
            },
            'expired-callback': () => {
              current.current = null;
            },
            'error-callback': () => {
              current.current = null;
              failure.current = humanCheckMessage('rejected');
              settle(null, failure.current);
            },
          }) ?? null;
      })
      .catch(() => {
        if (cancelled) return;
        loadFailed.current = true;
        settle(null, humanCheckMessage('missing'));
      });
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action, settle]);

  const reset = useCallback(() => {
    current.current = null;
    failure.current = null;
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  const token = useCallback(async (): Promise<string | null> => {
    if (!siteKey) return null;
    if (current.current) return current.current;
    if (loadFailed.current) throw new Error(humanCheckMessage('missing'));
    if (failure.current) {
      // Show why, and start a new check so that trying again can pass.
      const message = failure.current;
      reset();
      throw new Error(message);
    }
    return new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.current = waiting.current.filter((entry) => entry !== done);
        reject(new Error(humanCheckMessage('missing')));
      }, WAIT_MS);
      const done = (value: string | null, reason?: string) => {
        clearTimeout(timer);
        if (value) resolve(value);
        else reject(new Error(reason ?? humanCheckMessage('rejected')));
      };
      waiting.current.push(done);
    });
  }, [siteKey, reset]);

  const widget = siteKey ? <div ref={container} className="empty:hidden" /> : null;

  return { widget, token, reset };
}
