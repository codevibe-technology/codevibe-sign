'use client';

import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { ADDRESS_MAX, checkAddressFormat, tidyAddressInput } from '@/lib/workspace-address';

export type AddressCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available' | 'current'; message: string }
  | { status: 'taken' | 'invalid'; message: string; suggestions: string[] }
  | { status: 'unknown'; message: string };

interface AddressAnswer {
  status: 'available' | 'current' | 'taken' | 'invalid';
  message: string;
  suggestions: string[];
}

export const CHECK_DELAY_MS = 350;

/**
 * Asks the server whether `slug` is free, `CHECK_DELAY_MS` after the last keystroke. Problems
 * the browser can see on its own (a bad character, too short) show at once without a request.
 */
export function useAddressCheck(slug: string, workspace?: { id: string; slug: string }) {
  const [state, setState] = useState<AddressCheckState>({ status: 'idle' });
  const workspaceId = workspace?.id;
  const current = workspace?.slug;

  useEffect(() => {
    if (current !== undefined && slug === current) {
      setState({ status: 'current', message: 'This is the address now.' });
      return;
    }
    const format = checkAddressFormat(slug);
    if (!format.ok && format.problem === 'empty') {
      setState({ status: 'idle' });
      return;
    }
    if (!format.ok && format.problem !== 'reserved') {
      setState({ status: 'invalid', message: format.message, suggestions: [] });
      return;
    }
    setState({ status: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ slug });
      if (workspaceId) query.set('workspace', workspaceId);
      fetch(`/api/workspaces/address?${query}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as
            | { ok: true; data: AddressAnswer }
            | { ok: false; error: string }
            | null;
          if (!body || !body.ok) {
            setState({
              status: 'unknown',
              message:
                body?.error ??
                'Could not check the address now. It is checked again when you save.',
            });
            return;
          }
          const answer = body.data;
          if (answer.status === 'available' || answer.status === 'current') {
            setState({ status: answer.status, message: answer.message });
          } else {
            setState({
              status: answer.status,
              message: answer.message,
              suggestions: answer.suggestions,
            });
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          console.warn('address check failed', err instanceof Error ? err.message : err);
          setState({
            status: 'unknown',
            message: 'Could not check the address now. It is checked again when you save.',
          });
        });
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, workspaceId, current]);

  return state;
}

/** Whether a form should refuse to submit with this check showing. */
export const blocksSubmit = (state: AddressCheckState) =>
  state.status === 'taken' || state.status === 'invalid';

/**
 * The workspace address box: the fixed start of the link, which cannot be edited, and the part
 * people choose. Shows whether it is free while they type, with alternatives to pick.
 */
export function AddressField({
  host,
  value,
  onChange,
  check,
  error,
  label = 'Workspace address',
  autoFocus,
}: {
  host: string;
  value: string;
  onChange: (slug: string) => void;
  check: AddressCheckState;
  /** An error the server returned when saving; it wins over the live check. */
  error?: string | undefined;
  label?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const prefixId = `${id}-prefix`;
  const problem = error ?? (blocksSubmit(check) ? (check as { message: string }).message : null);
  const suggestions =
    !error && blocksSubmit(check) ? (check as { suggestions: string[] }).suggestions : [];

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-semibold text-ink">
        {label}
      </label>
      <div
        className={cn(
          'flex h-10 w-full items-stretch overflow-hidden rounded-md border bg-surface transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20',
          problem ? 'border-danger' : 'border-line-strong hover:border-muted/60',
        )}
      >
        <span
          id={prefixId}
          className="flex shrink-0 items-center border-r border-line bg-surface-2 px-2.5 text-[13px] text-muted select-none sm:px-3 sm:text-[14px]"
        >
          <span className="hidden sm:inline">{host}</span>/dashboard/
        </span>
        <input
          id={id}
          className="min-w-0 flex-1 bg-transparent px-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none"
          value={value}
          onChange={(e) => onChange(tidyAddressInput(e.target.value))}
          maxLength={ADDRESS_MAX}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          autoFocus={autoFocus}
          placeholder="your-team"
          aria-describedby={`${prefixId} ${noteId}`}
          aria-invalid={problem ? true : undefined}
        />
      </div>
      <p className="truncate text-[12.5px] text-muted sm:hidden" aria-hidden>
        {host}/dashboard/<span className="font-semibold text-ink">{value || 'your-team'}</span>
      </p>
      <div id={noteId} aria-live="polite" className="min-h-5 text-[13px]">
        <AddressNote check={check} error={problem} />
        {suggestions.length ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-muted">Free:</span>
            {suggestions.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => onChange(slug)}
                className="rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[12.5px] font-medium text-ink hover:border-primary hover:text-primary focus-visible:ring-3 focus-visible:ring-primary/20 focus-visible:outline-none"
              >
                {slug}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AddressNote({ check, error }: { check: AddressCheckState; error: string | null }) {
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-danger">
        <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {error}
      </p>
    );
  }
  switch (check.status) {
    case 'checking':
      return (
        <p className="flex items-center gap-1.5 text-muted">
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Checking…
        </p>
      );
    case 'available':
      return (
        <p className="flex items-center gap-1.5 font-medium text-success">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Available
        </p>
      );
    case 'current':
    case 'unknown':
      return <p className="text-muted">{check.message}</p>;
    default:
      return <p className="text-muted">Letters, numbers and hyphens. You can change it later.</p>;
  }
}
