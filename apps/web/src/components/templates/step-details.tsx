'use client';

import { FileText, Users } from 'lucide-react';
import { RecipientDot } from '@/components/envelopes/send/step-recipients';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { AUTH_LABELS, ROLE_OPTIONS } from '@/lib/envelopes';
import {
  EXPIRY_OPTIONS,
  MESSAGE_MAX,
  REMINDER_OPTIONS,
  TITLE_MAX,
  type DraftSettings,
  type Problems,
} from '@/lib/send-flow';
import {
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_NAME_MAX,
  type TemplateEditorState,
  type TemplateStep,
} from '@/lib/templates';
import { roleColor } from './step-roles';

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));
const HERE = ['name', 'description', 'title', 'message', 'expiresInDays'];

/** Step 4: what the template is called and what each envelope from it says. */
export function StepDetails({
  state,
  problems,
  onChange,
  onSettings,
  onGoTo,
}: {
  state: TemplateEditorState;
  problems: Problems;
  onChange: (patch: Partial<Pick<TemplateEditorState, 'name' | 'description'>>) => void;
  onSettings: (patch: Partial<DraftSettings>) => void;
  onGoTo: (step: TemplateStep) => void;
}) {
  const { settings } = state;
  const elsewhere = Object.entries(problems).filter(([key]) => !HERE.includes(key));
  const expiryOptions = EXPIRY_OPTIONS.includes(settings.expiresInDays as never)
    ? EXPIRY_OPTIONS
    : [...EXPIRY_OPTIONS, settings.expiresInDays].sort((a, b) => a - b);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <Card>
          <CardHeader title="Template" description="How your team finds it in the list." />
          <div className="space-y-4 px-5 py-5">
            <Field label="Name" error={problems.name}>
              {(props) => (
                <Input
                  {...props}
                  value={state.name}
                  maxLength={TEMPLATE_NAME_MAX}
                  placeholder="Offer letter"
                  onChange={(e) => onChange({ name: e.target.value })}
                />
              )}
            </Field>
            <Field
              label="Description (optional)"
              hint="When to use it, for example: full-time hires in India."
              error={problems.description}
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={state.description}
                  maxLength={TEMPLATE_DESCRIPTION_MAX}
                  onChange={(e) => onChange({ description: e.target.value })}
                />
              )}
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Each envelope"
            description="The sender can still change the title and message when sending."
          />
          <div className="space-y-4 px-5 py-5">
            <Field
              label="Email subject and title"
              hint="Leave empty to use the template name."
              error={problems.title}
            >
              {(props) => (
                <Input
                  {...props}
                  value={settings.title}
                  maxLength={TITLE_MAX}
                  placeholder={state.name || 'Offer letter'}
                  onChange={(e) => onSettings({ title: e.target.value })}
                />
              )}
            </Field>
            <Field label="Message (optional)" error={problems.message}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={settings.message}
                  maxLength={MESSAGE_MAX}
                  onChange={(e) => onSettings({ message: e.target.value })}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expires after" error={problems.expiresInDays}>
                {(props) => (
                  <NativeSelect
                    {...props}
                    value={settings.expiresInDays}
                    onChange={(e) => onSettings({ expiresInDays: Number(e.target.value) })}
                  >
                    {expiryOptions.map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Automatic reminders" hint="Sent until they act, up to 5 times.">
                {(props) => (
                  <NativeSelect
                    {...props}
                    value={settings.remindEveryDays}
                    onChange={(e) => onSettings({ remindEveryDays: Number(e.target.value) })}
                  >
                    {REMINDER_OPTIONS.map((o) => (
                      <option key={o.days} value={o.days}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        {elsewhere.length > 0 ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            <p className="font-semibold">Fix these before saving:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {elsewhere.map(([key, message]) => {
                const step: TemplateStep = key.startsWith('fields')
                  ? 'fields'
                  : key.startsWith('roles')
                    ? 'roles'
                    : 'documents';
                return (
                  <li key={key}>
                    {message}{' '}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => onGoTo(step)}
                    >
                      Fix
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <Card>
          <CardHeader title="Summary" />
          <div className="space-y-4 px-5 py-4 text-sm">
            <div>
              <p className="mb-1 flex items-center gap-2 font-semibold">
                <FileText aria-hidden className="h-4 w-4 text-muted" />
                {state.documents.length} {state.documents.length === 1 ? 'document' : 'documents'}
              </p>
              <ul className="space-y-0.5 pl-6 text-muted">
                {state.documents.map((d) => (
                  <li key={d.id} className="truncate">
                    {d.name}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-2 font-semibold">
                <Users aria-hidden className="h-4 w-4 text-muted" />
                {state.routing === 'sequential' ? 'Roles, in this order' : 'Roles, all at once'}
              </p>
              <ol className="space-y-1.5 pl-6">
                {state.roles.map((r) => {
                  const count = state.fields.filter((f) => f.recipientId === r.id).length;
                  return (
                    <li key={r.id} className="flex items-center gap-2">
                      <RecipientDot index={roleColor(state.roles, r.id)} />
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-ink">{r.name || 'Unnamed'}</span>{' '}
                        <span className="text-muted">
                          {ROLE_LABEL[r.type]}
                          {r.type !== 'viewer' ? ` · ${AUTH_LABELS[r.auth]}` : ''}
                          {r.type === 'signer'
                            ? ` · ${count} ${count === 1 ? 'field' : 'fields'}`
                            : ''}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
