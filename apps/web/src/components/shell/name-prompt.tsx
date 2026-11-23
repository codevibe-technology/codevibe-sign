'use client';

import { UserRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { useAction } from '@/components/settings/use-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { PERSON_NAME_MAX, personNameProblem } from '@/lib/person-name';
import { updateNameAction } from '@/server/actions/personal';

export const NAME_PROMPT_KEY = 'cvs.name-prompt.dismissed';

const listeners = new Set<() => void>();
// Stands in for sessionStorage where the browser refuses it, so "Not now" still works.
let dismissedInMemory = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(NAME_PROMPT_KEY) === '1';
  } catch {
    return dismissedInMemory;
  }
}

function dismiss() {
  try {
    window.sessionStorage.setItem(NAME_PROMPT_KEY, '1');
  } catch {
    dismissedInMemory = true;
  }
  for (const listener of listeners) listener();
}

/**
 * Asks a member who has saved no name to add one, without getting in the way. The server
 * decides whether to render it at all. "Not now" hides it for this browser session only; it
 * is back in the next one until a name is saved. It reads the session's dismissal after the
 * first paint, so the server's HTML and the browser's always agree.
 */
export function NamePrompt() {
  const router = useRouter();
  const hidden = useSyncExternalStore(subscribe, isDismissed, () => true);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { pending, errors, run } = useAction();

  if (hidden || saved) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = personNameProblem(name);
    setProblem(found);
    if (found) return;
    run(() => updateNameAction({ name }), {
      success: 'Your name is saved',
      onSuccess: () => {
        setSaved(true);
        router.refresh();
      },
    });
  }

  const error = problem ?? errors.name;
  return (
    <section
      aria-label="Add your name"
      className="mb-6 flex flex-wrap items-start gap-x-4 gap-y-3 rounded-xl border border-primary/25 bg-primary-soft px-5 py-4"
    >
      <UserRound aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 basis-64 text-sm">
        <p className="font-semibold text-ink">Add your name</p>
        <p className="mt-0.5 text-muted">
          Your team and the audit trail show your email address until you do.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <label htmlFor="name-prompt-field" className="sr-only">
            Your name
          </label>
          <Input
            id="name-prompt-field"
            name="name"
            autoComplete="name"
            placeholder="Your full name"
            maxLength={PERSON_NAME_MAX}
            value={name}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'name-prompt-error' : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
          />
          <Button type="submit" pending={pending}>
            Save
          </Button>
        </div>
        {error ? (
          <p id="name-prompt-error" role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </form>
      <Button variant="ghost" size="icon" aria-label="Not now" onClick={dismiss}>
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </section>
  );
}
