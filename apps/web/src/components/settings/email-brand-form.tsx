'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  DEFAULT_MAIL_TEXT,
  INTRO_MAX,
  KIND_VARIABLES,
  MAIL_KINDS,
  MAIL_KIND_LABELS,
  MAIL_VARIABLES,
  SUBJECT_MAX,
  renderMail,
  sampleInput,
  type MailKind,
  type MailOverrides,
} from '@/lib/mail-templates';
import { updateEmailSettingsAction } from '@/server/actions/brand';
import { useAction } from './use-action';

export interface EmailBrandValues {
  senderName: string;
  replyTo: string;
  overrides: MailOverrides;
}

type Part = 'subject' | 'intro';

/** Who emails appear to come from, and the subject and opening text of each email. */
export function EmailBrandForm({
  workspace,
  values,
  look,
}: {
  workspace: { id: string; name: string };
  values: EmailBrandValues;
  look: { brandColor: string; logoUrl: string | null; showBadge: boolean };
}) {
  const [senderName, setSenderName] = useState(values.senderName);
  const [replyTo, setReplyTo] = useState(values.replyTo);
  const [overrides, setOverrides] = useState<MailOverrides>(values.overrides);
  const [kind, setKind] = useState<MailKind>('invite');
  const lastPart = useRef<Part>('intro');
  const inputs = useRef<Record<Part, HTMLInputElement | HTMLTextAreaElement | null>>({
    subject: null,
    intro: null,
  });
  const save = useAction();

  const company = senderName.trim() || workspace.name;
  const current = overrides[kind] ?? {};
  const preview = useMemo(
    () =>
      renderMail(
        kind,
        sampleInput(kind),
        { company, brandColor: look.brandColor, logoUrl: look.logoUrl, showBadge: look.showBadge },
        overrides[kind],
      ),
    [kind, company, look, overrides],
  );

  const setPart = (part: Part, value: string) =>
    setOverrides((prev) => ({ ...prev, [kind]: { ...prev[kind], [part]: value } }));

  /** Puts `{{name}}` where the cursor was in the subject or text last edited. */
  function insertVariable(name: string) {
    const part = lastPart.current;
    const el = inputs.current[part];
    const text = current[part] ?? '';
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setPart(part, text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.run(
      () =>
        updateEmailSettingsAction({ workspaceId: workspace.id, senderName, replyTo, overrides }),
      { success: 'Email settings saved' },
    );
  }

  const fieldError = (part: Part) => save.errors[`overrides.${kind}.${part}`];
  const kindWithError = MAIL_KINDS.find((k) =>
    Object.keys(save.errors).some((key) => key.startsWith(`overrides.${k}.`)),
  );
  useEffect(() => {
    if (kindWithError) setKind(kindWithError);
  }, [kindWithError]);

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Emails"
          description="Invitations, reminders and the final copies go out under your name."
        />
        <CardBody className="space-y-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Sender name"
              hint={`Emails come from "${company}". The address stays ours so they reach the inbox.`}
              error={save.errors.senderName}
            >
              {(props) => (
                <Input
                  {...props}
                  maxLength={60}
                  placeholder={workspace.name}
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Reply-to address"
              hint="Where replies go. Leave empty to send replies nowhere."
              error={save.errors.replyTo}
            >
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="hr@example.com"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div>
            <div
              role="tablist"
              aria-label="Email"
              className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1"
            >
              {MAIL_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  id={`mail-tab-${k}`}
                  aria-selected={k === kind}
                  aria-controls="mail-panel"
                  onClick={() => setKind(k)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-semibold',
                    k === kind ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
                  )}
                >
                  {MAIL_KIND_LABELS[k]}
                  {overrides[k]?.subject?.trim() || overrides[k]?.intro?.trim() ? (
                    <span className="sr-only"> (customised)</span>
                  ) : null}
                  {kindWithError === k && k !== kind ? (
                    <span className="ml-1 text-danger" aria-label="has an error">
                      •
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <div
              id="mail-panel"
              role="tabpanel"
              aria-labelledby={`mail-tab-${kind}`}
              className="mt-4 space-y-4"
            >
              <Field
                label="Subject"
                hint={`Leave empty for: ${DEFAULT_MAIL_TEXT[kind].subject}`}
                error={fieldError('subject')}
              >
                {(props) => (
                  <Input
                    {...props}
                    ref={(el) => {
                      inputs.current.subject = el;
                    }}
                    maxLength={SUBJECT_MAX}
                    placeholder={DEFAULT_MAIL_TEXT[kind].subject}
                    value={current.subject ?? ''}
                    onFocus={() => {
                      lastPart.current = 'subject';
                    }}
                    onChange={(e) => setPart('subject', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Opening text"
                hint="Shown after the greeting. A blank line starts a new paragraph."
                error={fieldError('intro')}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    ref={(el) => {
                      inputs.current.intro = el;
                    }}
                    rows={4}
                    maxLength={INTRO_MAX}
                    placeholder={DEFAULT_MAIL_TEXT[kind].intro}
                    value={current.intro ?? ''}
                    onFocus={() => {
                      lastPart.current = 'intro';
                    }}
                    onChange={(e) => setPart('intro', e.target.value)}
                  />
                )}
              </Field>
              <div>
                <p className="text-sm font-semibold" id="variables-label">
                  Variables
                </p>
                <p className="text-sm text-muted">
                  Select one to add it where the cursor is. It is filled in for each person.
                </p>
                <ul aria-labelledby="variables-label" className="mt-2 flex flex-wrap gap-2">
                  {KIND_VARIABLES[kind].map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        title={MAIL_VARIABLES[name]}
                        onClick={() => insertVariable(name)}
                        className="rounded-md border border-line-strong bg-surface px-2 py-1 font-mono text-xs hover:bg-surface-2"
                      >
                        {`{{${name}}}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {current.subject || current.intro ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOverrides((prev) => ({ ...prev, [kind]: {} }))}
                >
                  <RotateCcw aria-hidden className="h-4 w-4" /> Use the default{' '}
                  {MAIL_KIND_LABELS[kind].toLowerCase()} text
                </Button>
              ) : null}
            </div>
          </div>

          <figure aria-label="Email preview" className="space-y-2">
            <figcaption className="text-sm font-semibold">Preview</figcaption>
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="text-muted">From </span>
              <span data-testid="preview-from">{company}</span>
              <span className="text-muted"> · Subject </span>
              <span data-testid="preview-subject">{preview.subject}</span>
            </p>
            <iframe
              title={`${MAIL_KIND_LABELS[kind]} email preview`}
              sandbox=""
              srcDoc={preview.html}
              className="h-[420px] w-full rounded-lg border border-line bg-white"
            />
          </figure>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={save.pending}>
            Save email settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
