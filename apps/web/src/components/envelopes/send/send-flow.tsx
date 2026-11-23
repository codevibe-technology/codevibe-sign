'use client';

import '@codevibe_technology/sign-react/styles.css';
import type { Field } from '@codevibe_technology/sign-core';
import type { ApiEnvelope as Envelope } from '@codevibe_technology/sign-server';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CloudOff,
  Eye,
  FileSignature,
  Loader2,
  Send,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ApiError, apiFetch, jsonBody } from '@/lib/api-client';
import {
  STEPS,
  adoptSavedRecipients,
  draftBody,
  emptySettings,
  localPath,
  recipientsBody,
  settingsBody,
  stepProblems,
  titleFromFileName,
  type DraftSettings,
  type Problems,
  type SendFlowState,
  type StepKey,
  withReplacedDocument,
} from '@/lib/send-flow';
import { replaceDocumentAction } from '@/server/actions/envelopes';
import { ExcludedDocumentNotice } from '@/components/legal/excluded-document-notice';
import { SendTour } from '@/components/tour/guided-tours';
import { StepDocuments } from './step-documents';
import { StepFields } from './step-fields';
import { StepRecipients, type EsignChoice } from './step-recipients';
import { StepReview } from './step-review';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export const emptyFlow = (): SendFlowState => ({
  envelopeId: null,
  documents: [],
  recipients: [],
  routing: 'sequential',
  fields: [],
  settings: emptySettings(),
});

const AUTOSAVE_MS = 1000;

/** Why the envelope this draft revises was declined, to address before sending again. */
export interface RevisionNote {
  title: string;
  declinedBy: string;
  role: string;
  reason: string | null;
}

export interface SendFlowProps {
  slug: string;
  workspaceId: string;
  me: { name: string; email: string };
  initial?: SendFlowState;
  initialStep?: StepKey;
  revision?: RevisionNote;
  /** Whether a signer can be asked to sign with Aadhaar eSign. */
  esign?: EsignChoice;
}

/**
 * Upload, recipients, fields, review. The draft is created on the server once there is
 * someone to send to, and every later change is saved on its own a moment after it is made.
 */
export function SendFlow({
  slug,
  workspaceId,
  me,
  initial,
  initialStep,
  revision,
  esign,
}: SendFlowProps) {
  const router = useRouter();
  const [state, setState] = useState<SendFlowState>(initial ?? emptyFlow);
  const [step, setStep] = useState<StepKey>(initialStep ?? 'documents');
  const [reached, setReached] = useState(
    STEPS.findIndex((s) => s.key === (initialStep ?? 'documents')),
  );
  const [shown, setShown] = useState<Partial<Record<StepKey, boolean>>>({});
  const [serverProblems, setServerProblems] = useState<Problems>({});
  const [save, setSave] = useState<SaveState>({ kind: initial ? 'saved' : 'idle' });
  const [busy, setBusy] = useState<'creating' | 'sending' | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const frame = useRef<HTMLDivElement>(null);
  useInertOutside(frame);
  const latest = useRef(state);
  latest.current = state;
  const lastSaved = useRef<string | null>(initial ? JSON.stringify(draftBody(initial)) : null);
  const saving = useRef<Promise<boolean> | null>(null);

  const index = STEPS.findIndex((s) => s.key === step);
  const live = useMemo(() => stepProblems(step, state), [step, state]);
  const problems = useMemo(
    () => ({ ...(shown[step] ? live : {}), ...serverProblems }),
    [shown, step, live, serverProblems],
  );

  const documentUrl = useCallback(
    (documentId: string) =>
      `/dashboard/${slug}/envelopes/${state.envelopeId}/documents/${documentId}?version=original`,
    [slug, state.envelopeId],
  );

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    const snapshot = latest.current;
    if (!snapshot.envelopeId) return true;
    const body = draftBody(snapshot);
    const text = JSON.stringify(body);
    if (text === lastSaved.current) return true;
    const run = (async () => {
      setSave({ kind: 'saving' });
      try {
        const saved = await apiFetch<Envelope>(
          workspaceId,
          `/v1/envelopes/${snapshot.envelopeId}`,
          jsonBody('PATCH', body),
        );
        lastSaved.current = text;
        setState((s) => adoptSavedRecipients(s, snapshot.recipients, saved.recipients));
        setServerProblems({});
        setSave({ kind: 'saved' });
        return true;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'The draft could not be saved.';
        const path =
          err instanceof ApiError ? localPath(err.field, snapshot.recipients) : undefined;
        if (path) setServerProblems({ [path]: message });
        setSave({ kind: 'error', message });
        return false;
      }
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      if (saving.current === run) saving.current = null;
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!state.envelopeId) return;
    if (JSON.stringify(draftBody(state)) === lastSaved.current) return;
    const timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [state, saveNow]);

  useEffect(() => {
    const unsaved =
      (!state.envelopeId && state.documents.length > 0) ||
      save.kind === 'saving' ||
      save.kind === 'error';
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.envelopeId, state.documents.length, save.kind]);

  const go = (next: StepKey) => {
    const i = STEPS.findIndex((s) => s.key === next);
    setStep(next);
    setPreviewing(false);
    setReached((r) => Math.max(r, i));
    setServerProblems({});
    const pane = document.getElementById('send-main');
    if (pane) pane.scrollTop = 0;
  };

  const update = (patch: (s: SendFlowState) => SendFlowState) => {
    setServerProblems({});
    setState(patch);
  };

  async function createDraft(): Promise<boolean> {
    const snapshot = latest.current;
    const fallback = titleFromFileName(snapshot.documents[0]!.name);
    const envelope = {
      ...settingsBody(snapshot.settings, fallback),
      routing: snapshot.routing,
      recipients: recipientsBody(snapshot),
      documents: snapshot.documents.map((d) => ({ key: d.id, name: d.name })),
    };
    if (envelope.message === null) delete (envelope as { message?: unknown }).message;
    const form = new FormData();
    form.set('envelope', JSON.stringify(envelope));
    for (const d of snapshot.documents) {
      form.append(
        'documents',
        new Blob([d.bytes as BlobPart], { type: 'application/pdf' }),
        d.name,
      );
    }
    setBusy('creating');
    try {
      const created = await apiFetch<Envelope>(workspaceId, '/v1/envelopes', {
        method: 'POST',
        body: form,
      });
      setState((s) => {
        const adopted = adoptSavedRecipients(s, snapshot.recipients, created.recipients);
        return {
          ...adopted,
          envelopeId: created.id,
          documents: s.documents.map((d, i) => ({ ...d, id: created.documents[i]?.id ?? d.id })),
          settings: { ...s.settings, title: s.settings.title || created.title },
        };
      });
      const url = new URL(window.location.href);
      url.searchParams.set('draft', created.id);
      window.history.replaceState(null, '', url);
      setSave({ kind: 'saved' });
      toast.success('Saved as a draft. Changes now save as you go.');
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The draft could not be created.';
      const path = err instanceof ApiError ? localPath(err.field, snapshot.recipients) : undefined;
      if (path && path !== 'documents') setServerProblems({ [path]: message });
      toast.error(message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function sendNow() {
    setBusy('sending');
    try {
      if (!(await saveNow())) {
        toast.error('Save the draft first: fix the problem shown, then send again.');
        return;
      }
      const id = latest.current.envelopeId!;
      await apiFetch<Envelope>(workspaceId, `/v1/envelopes/${id}/send`, jsonBody('POST', {}));
      const first = latest.current.recipients.find((r) => r.role !== 'viewer');
      toast.success(
        latest.current.routing === 'sequential' && first
          ? `Sent. ${first.name} gets the signing link now.`
          : 'Sent. Everyone gets their signing link now.',
      );
      router.push(`/dashboard/${slug}/envelopes/${id}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The envelope could not be sent.';
      if (err instanceof ApiError && err.field)
        setServerProblems({
          [err.field.replace(/^recipients\.([^.]+)\.fields$/, 'fields.$1')]: message,
        });
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  async function next() {
    if (Object.keys(live).length > 0) {
      setShown((s) => ({ ...s, [step]: true }));
      return;
    }
    if (step === 'documents') {
      if (!state.settings.title && state.documents[0]) {
        update((s) => ({
          ...s,
          settings: { ...s.settings, title: titleFromFileName(s.documents[0]!.name) },
        }));
      }
      go('recipients');
    } else if (step === 'recipients') {
      if (!state.envelopeId) {
        if (await createDraft()) go('fields');
      } else {
        void saveNow();
        go('fields');
      }
    } else if (step === 'fields') {
      void saveNow();
      go('review');
    } else {
      await sendNow();
    }
  }

  const back = () => index > 0 && go(STEPS[index - 1]!.key);

  async function replaceDocument(documentId: string, file: File) {
    const envelopeId = latest.current.envelopeId;
    if (!envelopeId) return { error: 'Save the draft first.' };
    if (!(await saveNow())) return { error: 'The draft could not be saved. Try again.' };
    const form = new FormData();
    form.set('workspaceId', workspaceId);
    form.set('envelopeId', envelopeId);
    form.set('documentId', documentId);
    form.set('file', file);
    const result = await replaceDocumentAction(form);
    if (!result.ok) return { error: result.error };
    const next = withReplacedDocument(latest.current, result.data.envelope, documentId);
    lastSaved.current = JSON.stringify(draftBody(next));
    setState(next);
    return { moved: result.data.movedFields.length };
  }

  const current = STEPS[index]!;
  const nextStep = STEPS[index + 1];
  const intro = STEP_INTRO[step];
  const headline =
    state.settings.title || (state.envelopeId ? 'Untitled envelope' : 'Send a document');

  return (
    <div
      ref={frame}
      className="fixed inset-0 z-40 flex flex-col bg-canvas"
      data-testid="send-flow"
      role="region"
      aria-label="Send a document"
    >
      <header className="relative z-10 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 shadow-[0_1px_2px_rgb(13_27_42/0.04)] sm:px-5">
        <Button asChild variant="ghost" size="icon" className="text-muted">
          <Link
            href={`/dashboard/${slug}/envelopes`}
            aria-label={state.envelopeId ? 'Close' : 'Cancel'}
            title={state.envelopeId ? 'Close' : 'Cancel'}
          >
            <X aria-hidden className="h-5 w-5" />
          </Link>
        </Button>
        <span aria-hidden className="hidden h-8 w-px bg-line sm:block" />
        <span
          aria-hidden
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary sm:flex"
        >
          <FileSignature className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1 min-[1720px]:max-w-[340px] min-[1720px]:flex-none">
          <h1
            className="truncate font-display text-[15px] leading-tight font-bold tracking-tight text-ink sm:text-base"
            title={headline}
          >
            {headline}
          </h1>
          <SaveIndicator
            state={save}
            hasDraft={state.envelopeId !== null}
            onRetry={() => void saveNow()}
          />
        </div>
        <StepTrail current={step} reached={reached} onSelect={go} />
        <CompactTrail current={step} reached={reached} onSelect={go} />
        <div className="ml-auto hidden shrink-0 items-center gap-2 lg:flex">
          {step === 'fields' && state.recipients.some((r) => r.role !== 'viewer') ? (
            <Button
              type="button"
              variant="secondary"
              data-tour="send-preview"
              aria-pressed={previewing}
              onClick={() => setPreviewing((p) => !p)}
            >
              <Eye aria-hidden className="h-4 w-4" />
              {previewing ? 'Back to editing' : 'Preview as signer'}
            </Button>
          ) : null}
        </div>
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:static lg:z-auto lg:ml-0 lg:shrink-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <Button
            type="button"
            variant="secondary"
            onClick={back}
            disabled={index === 0 || busy !== null}
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Back
          </Button>
          <Button
            type="button"
            onClick={() => void next()}
            pending={busy !== null}
            data-tour="send-next"
            className="min-w-[132px] shadow-[0_8px_18px_-8px_rgb(27_106_224/0.6)]"
          >
            {busy === 'creating' ? (
              <>
                <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Saving draft…
              </>
            ) : busy === 'sending' ? (
              <>
                <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Sending…
              </>
            ) : step === 'review' ? (
              <>
                <Send aria-hidden className="h-4 w-4" />
                Send now
              </>
            ) : (
              <>
                <span>
                  Continue
                  <span className="hidden xl:inline"> to {nextStep?.label.toLowerCase()}</span>
                </span>
                <ArrowRight aria-hidden className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </header>

      <div
        className="border-b border-line bg-surface px-4 py-2 lg:hidden"
        data-tour="send-progress"
      >
        <p className="text-[13px] text-muted">
          Step {index + 1} of {STEPS.length} ·{' '}
          <span className="font-semibold text-ink">{current.label}</span>
        </p>
        <div aria-hidden className="mt-1.5 grid grid-cols-4 gap-1">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={cn('h-1 rounded-full', i <= index ? 'bg-primary' : 'bg-line')}
            />
          ))}
        </div>
      </div>

      <div
        id="send-main"
        className={cn(
          'min-h-0 flex-1 pb-20 lg:pb-0',
          step === 'fields' ? 'overflow-y-auto lg:overflow-hidden' : 'overflow-y-auto',
        )}
      >
        {revision || step !== 'fields' ? (
          <div
            className={cn(
              'mx-auto w-full px-4 sm:px-8',
              step === 'fields' ? 'max-w-none pt-3' : 'max-w-5xl pt-8 sm:pt-10',
            )}
          >
            {revision ? (
              <aside
                aria-label="Why it was declined"
                className="mb-5 rounded-xl border border-danger/30 border-l-[3px] border-l-danger bg-danger-soft px-4 py-3 text-sm text-ink"
              >
                <p className="font-semibold">
                  Declined by {revision.declinedBy} ({revision.role}): “{revision.title}”
                </p>
                <p className="mt-1 break-words whitespace-pre-line">
                  {revision.reason ?? 'No reason was given.'}
                </p>
                <p className="mt-1 text-muted">
                  Everyone signs this revision again; signatures on the declined one are not carried
                  over.
                </p>
              </aside>
            ) : null}
            <ExcludedDocumentNotice
              names={[state.settings.title, ...state.documents.map((d) => d.name)]}
            />
            {step !== 'fields' ? (
              <div className="mb-6 sm:mb-8">
                <p className="eyebrow mb-2 hidden items-center gap-2 lg:flex">
                  <span aria-hidden className="h-[2px] w-5 bg-accent" />
                  Step {index + 1} of {STEPS.length}
                </p>
                <h2 className="text-[26px] leading-tight font-bold text-ink sm:text-[30px]">
                  {intro.title}
                </h2>
                <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{intro.lead}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 'fields' ? (
          <div className="lg:h-full">
            <StepFields
              layout="fill"
              documents={state.documents}
              documentUrl={documentUrl}
              recipients={state.recipients}
              fields={state.fields}
              problems={problems}
              previewing={previewing}
              onPreviewingChange={setPreviewing}
              onChange={(fields: Field[]) => update((s) => ({ ...s, fields }))}
            />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl px-4 pb-12 sm:px-8">
            {step === 'documents' ? (
              <StepDocuments
                workspaceId={workspaceId}
                documents={state.documents}
                locked={state.envelopeId !== null}
                error={problems.documents}
                onChange={(fn) => update((s) => ({ ...s, documents: fn(s.documents) }))}
                {...(state.envelopeId ? { onReplace: replaceDocument } : {})}
              />
            ) : step === 'recipients' ? (
              <StepRecipients
                recipients={state.recipients}
                routing={state.routing}
                problems={problems}
                me={me}
                {...(esign ? { esign } : {})}
                onChange={(fn) => update((s) => ({ ...s, recipients: fn(s.recipients) }))}
                onRoutingChange={(routing) => update((s) => ({ ...s, routing }))}
              />
            ) : (
              <StepReview
                state={state}
                problems={problems}
                sender={me}
                onSettings={(patch: Partial<DraftSettings>) =>
                  update((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
                }
                onGoTo={(target) => {
                  setShown((s) => ({ ...s, [target]: true }));
                  go(target);
                }}
              />
            )}
          </div>
        )}
      </div>
      <SendTour step={step} />
    </div>
  );
}

/**
 * The send flow covers the whole window, so the app around it is taken out of the tab order
 * and away from screen readers while it is open, as a dialog would be. Toasts stay reachable.
 */
function useInertOutside(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const changed: HTMLElement[] = [];
    let node = ref.current;
    while (node?.parentElement && node !== document.body) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (
          sibling === node ||
          !(sibling instanceof HTMLElement) ||
          sibling.inert ||
          sibling.matches('script, style, [data-sonner-toaster]') ||
          sibling.querySelector('[data-sonner-toaster]')
        ) {
          continue;
        }
        sibling.inert = true;
        changed.push(sibling);
      }
      node = node.parentElement;
    }
    return () => {
      for (const el of changed) el.inert = false;
    };
  }, [ref]);
}

const STEP_INTRO: Record<StepKey, { title: string; lead: string }> = {
  documents: {
    title: 'Add the documents',
    lead: 'PDFs only. Each file is checked as you add it, so problems show up now and not when you send.',
  },
  recipients: {
    title: 'Who needs to sign?',
    lead: 'Add signers, approvers and people who only get a copy. Their colour follows them onto the page.',
  },
  fields: { title: 'Place the fields', lead: '' },
  review: {
    title: 'Review and send',
    lead: 'Check the email your recipients get and what each of them has to do.',
  },
};

/** The four steps as a compact trail in the top bar; reached ones can be revisited. */
function StepTrail({
  current,
  reached,
  onSelect,
}: {
  current: StepKey;
  reached: number;
  onSelect: (step: StepKey) => void;
}) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <nav
      aria-label="Steps"
      className="hidden min-w-0 flex-1 justify-center min-[1720px]:flex"
      data-tour="send-steps"
    >
      <ol className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const done = i < index;
          const active = i === index;
          const reachable = i <= reached;
          return (
            <li key={s.key} className="flex items-center gap-1">
              {i > 0 ? (
                <span
                  aria-hidden
                  className={cn('h-px w-6 xl:w-10', i <= index ? 'bg-primary' : 'bg-line-strong')}
                />
              ) : null}
              <button
                type="button"
                disabled={!reachable || active}
                onClick={() => onSelect(s.key)}
                aria-current={active ? 'step' : undefined}
                aria-label={s.label}
                className={cn(
                  'flex items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors disabled:cursor-default',
                  active && 'bg-primary-soft text-primary',
                  done && 'text-ink hover:bg-surface-2',
                  !active && !done && 'text-muted',
                  reachable && !active && !done && 'hover:bg-surface-2',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-[11.5px] font-bold',
                    active && 'bg-primary text-primary-ink',
                    done && 'bg-success text-white',
                    !active && !done && 'border border-line-strong bg-surface text-muted',
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The trail where the full one does not fit beside the title and the buttons: a dot per step
 * (reached ones can be revisited) and the current step by name.
 */
function CompactTrail({
  current,
  reached,
  onSelect,
}: {
  current: StepKey;
  reached: number;
  onSelect: (step: StepKey) => void;
}) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <nav
      aria-label="Steps"
      className="hidden shrink-0 items-center gap-3 rounded-full bg-surface-2 py-1.5 pr-3.5 pl-2 lg:max-[1719px]:flex"
      data-tour="send-steps"
    >
      <ol className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={i > reached || active}
                onClick={() => onSelect(s.key)}
                aria-current={active ? 'step' : undefined}
                aria-label={s.label}
                title={s.label}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors disabled:cursor-default',
                  active && 'bg-primary text-primary-ink',
                  done && 'bg-success text-white hover:opacity-90',
                  !active && !done && 'border border-line-strong bg-surface text-muted',
                )}
              >
                {done ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-[13px] font-semibold whitespace-nowrap text-ink">
        <span className="text-muted">
          Step {index + 1} of {STEPS.length} ·{' '}
        </span>
        {STEPS[index]!.label}
      </p>
    </nav>
  );
}

function SaveIndicator({
  state,
  hasDraft,
  onRetry,
}: {
  state: SaveState;
  hasDraft: boolean;
  onRetry: () => void;
}) {
  if (!hasDraft) {
    return (
      <p className="truncate text-[12.5px] text-muted">
        Saved as a draft as soon as you add who it goes to.
      </p>
    );
  }
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted" aria-live="polite">
      {state.kind === 'saving' ? (
        <>
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          Saving…
        </>
      ) : state.kind === 'error' ? (
        <span className="flex flex-wrap items-center gap-1.5 text-danger">
          <CloudOff aria-hidden className="h-3.5 w-3.5" />
          Not saved: {state.message}
          <button type="button" onClick={onRetry} className="font-semibold underline">
            Retry
          </button>
        </span>
      ) : (
        <>
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-success" />
          Draft saved
        </>
      )}
    </p>
  );
}
