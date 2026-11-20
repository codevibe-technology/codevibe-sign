'use client';

import '@codevibe_technology/sign-react/styles.css';
import type { Field as PlacedField } from '@codevibe_technology/sign-core';
import { ArrowLeft, ArrowRight, Loader2, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { StepDocuments } from '@/components/envelopes/send/step-documents';
import { StepFields } from '@/components/envelopes/send/step-fields';
import { Stepper } from '@/components/envelopes/send/stepper';
import { Button } from '@/components/ui/button';
import type { DraftSettings, Problems } from '@/lib/send-flow';
import {
  STEPS,
  definitionInput,
  emptyTemplate,
  rolesAsRecipients,
  templateStepProblems,
  type TemplateEditorState,
  type TemplateStep,
} from '@/lib/templates';
import {
  createTemplateAction,
  stageTemplateDocumentAction,
  updateTemplateAction,
} from '@/server/actions/templates';
import { StepDetails } from './step-details';
import { StepRoles } from './step-roles';

export interface TemplateEditorProps {
  slug: string;
  workspaceId: string;
  initial?: TemplateEditorState;
}

/** Which step a server problem belongs to. */
export function stepOf(field: string | undefined): TemplateStep {
  if (!field) return 'details';
  if (field.startsWith('documents')) return 'documents';
  if (field.startsWith('roles')) return 'roles';
  if (field.startsWith('fields')) return 'fields';
  return 'details';
}

/**
 * Documents, roles, fields, details. A new template is saved at the end; a saved one can be
 * changed on any step and saved from there, except its documents.
 */
export function TemplateEditor({ slug, workspaceId, initial }: TemplateEditorProps) {
  const router = useRouter();
  const editing = Boolean(initial?.templateId);
  const [state, setState] = useState<TemplateEditorState>(initial ?? emptyTemplate);
  const [step, setStep] = useState<TemplateStep>('documents');
  const [reached, setReached] = useState(editing ? STEPS.length - 1 : 0);
  const [shown, setShown] = useState<Partial<Record<TemplateStep, boolean>>>({});
  const [serverProblems, setServerProblems] = useState<Problems>({});
  const [saving, setSaving] = useState(false);

  const index = STEPS.findIndex((s) => s.key === step);
  const live = useMemo(() => templateStepProblems(step, state), [step, state]);
  const problems = useMemo(
    () => ({ ...(shown[step] ? live : {}), ...serverProblems }),
    [shown, step, live, serverProblems],
  );
  const recipients = useMemo(() => rolesAsRecipients(state.roles), [state.roles]);
  const documentUrl = useCallback(
    (documentId: string) => `/w/${slug}/templates/${state.templateId}/documents/${documentId}`,
    [slug, state.templateId],
  );

  const update = (patch: (s: TemplateEditorState) => TemplateEditorState) => {
    setServerProblems({});
    setState(patch);
  };

  const go = (next: TemplateStep) => {
    setStep(next);
    setReached((r) =>
      Math.max(
        r,
        STEPS.findIndex((s) => s.key === next),
      ),
    );
    setServerProblems({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function save() {
    const all = templateStepProblems('details', state);
    if (Object.keys(all).length > 0) {
      const first = Object.keys(all)[0];
      setShown({ documents: true, roles: true, fields: true, details: true });
      go(stepOf(first));
      return;
    }
    setSaving(true);
    try {
      const definition = definitionInput(state);
      const result = state.templateId
        ? await updateTemplateAction({ workspaceId, templateId: state.templateId, definition })
        : await createTemplateAction({
            workspaceId,
            definition,
            documents: state.documents.map((d) => ({
              id: d.id,
              name: d.name,
              stagedKey: d.stagedKey ?? '',
              pages: d.pages,
            })),
          });
      if (!result.ok) {
        if (result.field) {
          setServerProblems({ [result.field]: result.error });
          setStep(stepOf(result.field));
        }
        toast.error(result.error);
        return;
      }
      toast.success(
        editing ? 'Template saved.' : 'Template created. Send it whenever you need it.',
      );
      router.push(`/w/${slug}/templates`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function next() {
    if (Object.keys(live).length > 0) {
      setShown((s) => ({ ...s, [step]: true }));
      return;
    }
    if (step === 'details') {
      void save();
      return;
    }
    go(STEPS[index + 1]!.key);
  }

  const last = step === 'details';

  return (
    <div className="pb-24 sm:pb-0">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5 flex items-center gap-2">
            <span aria-hidden className="h-[2px] w-5 bg-accent" />
            Templates
          </p>
          <h1 className="text-[24px] leading-tight font-bold text-ink md:text-[26px]">
            {editing ? 'Edit template' : 'New template'}
            {state.name.trim() ? (
              <span className="font-normal text-muted">: {state.name.trim()}</span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {editing
              ? 'Changes apply to envelopes sent from now on; ones already sent stay as they are.'
              : 'Upload the document once, mark who signs where, and reuse it.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing && !last ? (
            <Button type="button" variant="secondary" onClick={() => void save()} pending={saving}>
              <Save aria-hidden className="h-4 w-4" />
              Save
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href={`/w/${slug}/templates`}>Cancel</Link>
          </Button>
        </div>
      </div>

      <Stepper steps={STEPS} current={step} reached={reached} onSelect={go} />

      {step === 'documents' ? (
        <StepDocuments
          workspaceId={workspaceId}
          documents={state.documents}
          locked={editing}
          lockedNote="A saved template keeps its documents, so the fields stay where they were placed. To use other files, create a new template."
          error={problems.documents}
          inspect={stageTemplateDocumentAction}
          onChange={(fn) =>
            update((s) => {
              const documents = fn(s.documents);
              const ids = new Set(documents.map((d) => d.id));
              return { ...s, documents, fields: s.fields.filter((f) => ids.has(f.documentId)) };
            })
          }
        />
      ) : step === 'roles' ? (
        <StepRoles
          roles={state.roles}
          routing={state.routing}
          problems={problems}
          onChange={(fn) =>
            update((s) => {
              const roles = fn(s.roles);
              const actors = new Set(roles.filter((r) => r.type !== 'viewer').map((r) => r.id));
              return { ...s, roles, fields: s.fields.filter((f) => actors.has(f.recipientId)) };
            })
          }
          onRoutingChange={(routing) => update((s) => ({ ...s, routing }))}
        />
      ) : step === 'fields' ? (
        <StepFields
          documents={state.documents}
          documentUrl={documentUrl}
          recipients={recipients}
          fields={state.fields}
          problems={problems}
          onChange={(fields: PlacedField[]) => update((s) => ({ ...s, fields }))}
        />
      ) : (
        <StepDetails
          state={state}
          problems={problems}
          onChange={(patch) => update((s) => ({ ...s, ...patch }))}
          onSettings={(patch: Partial<DraftSettings>) =>
            update((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
          }
          onGoTo={(target) => {
            setShown((s) => ({ ...s, [target]: true }));
            go(target);
          }}
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => index > 0 && go(STEPS[index - 1]!.key)}
            disabled={index === 0 || saving}
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Back
          </Button>
          <Button type="button" onClick={next} pending={saving}>
            {saving ? (
              <>
                <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Saving…
              </>
            ) : last ? (
              <>
                <Save aria-hidden className="h-4 w-4" />
                {editing ? 'Save changes' : 'Save template'}
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
