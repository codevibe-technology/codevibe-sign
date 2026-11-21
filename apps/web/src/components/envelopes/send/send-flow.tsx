'use client';

import '@codevibe_technology/sign-react/styles.css';
import type { Envelope, Field } from '@codevibe_technology/sign-core';
import { ArrowLeft, ArrowRight, CheckCircle2, CloudOff, Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { StepDocuments } from './step-documents';
import { StepFields } from './step-fields';
import { StepRecipients } from './step-recipients';
import { StepReview } from './step-review';
import { Stepper } from './stepper';

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
}

/**
 * Upload, recipients, fields, review. The draft is created on the server once there is
 * someone to send to, and every later change is saved on its own a moment after it is made.
 */
export function SendFlow({ slug, workspaceId, me, initial, initialStep, revision }: SendFlowProps) {
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
      `/w/${slug}/envelopes/${state.envelopeId}/documents/${documentId}?version=original`,
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
    setReached((r) => Math.max(r, i));
    setServerProblems({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      router.push(`/w/${slug}/envelopes/${id}`);
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

  return (
    <div className="pb-24 sm:pb-0">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5 flex items-center gap-2">
            <span aria-hidden className="h-[2px] w-5 bg-accent" />
            New envelope
          </p>
          <h1 className="text-[24px] leading-tight font-bold text-ink md:text-[26px]">
            {state.envelopeId ? 'Draft' : 'Send a document'}
            {state.envelopeId && state.settings.title ? (
              <span className="font-normal text-muted">: {state.settings.title}</span>
            ) : null}
          </h1>
          <SaveIndicator
            state={save}
            hasDraft={state.envelopeId !== null}
            onRetry={() => void saveNow()}
          />
        </div>
        <Button asChild variant="ghost">
          <Link href={`/w/${slug}/envelopes`}>{state.envelopeId ? 'Close' : 'Cancel'}</Link>
        </Button>
      </div>

      {revision ? (
        <aside
          aria-label="Why it was declined"
          className="mb-5 rounded-lg border border-danger/30 border-l-[3px] border-l-danger bg-danger-soft px-4 py-3 text-sm text-ink"
        >
          <p className="font-semibold">
            Declined by {revision.declinedBy} ({revision.role}): “{revision.title}”
          </p>
          <p className="mt-1 break-words whitespace-pre-line">
            {revision.reason ?? 'No reason was given.'}
          </p>
          <p className="mt-1 text-muted">
            Everyone signs this revision again; signatures on the declined one are not carried over.
          </p>
        </aside>
      ) : null}

      <ExcludedDocumentNotice
        names={[state.settings.title, ...state.documents.map((d) => d.name)]}
      />

      <Stepper current={step} reached={reached} onSelect={go} />

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
          onChange={(fn) => update((s) => ({ ...s, recipients: fn(s.recipients) }))}
          onRoutingChange={(routing) => update((s) => ({ ...s, routing }))}
        />
      ) : step === 'fields' ? (
        <StepFields
          documents={state.documents}
          documentUrl={documentUrl}
          recipients={state.recipients}
          fields={state.fields}
          problems={problems}
          onChange={(fields: Field[]) => update((s) => ({ ...s, fields }))}
        />
      ) : (
        <StepReview
          state={state}
          problems={problems}
          onSettings={(patch: Partial<DraftSettings>) =>
            update((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
          }
          onGoTo={(target) => {
            setShown((s) => ({ ...s, [target]: true }));
            go(target);
          }}
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:sticky sm:bottom-3 sm:mt-4 sm:rounded-lg sm:border sm:px-4 sm:shadow-card">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={back}
            disabled={index === 0 || busy !== null}
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Back
          </Button>
          <Button type="button" onClick={() => void next()} pending={busy !== null}>
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
                Send
              </>
            ) : (
              <>
                Continue
                <ArrowRight aria-hidden className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
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
      <p className="mt-1 text-sm text-muted">Saved as a draft as soon as you add who it goes to.</p>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted" aria-live="polite">
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
