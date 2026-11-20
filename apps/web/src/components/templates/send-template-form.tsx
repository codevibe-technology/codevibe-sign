'use client';

import { Loader2, Send, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { RecipientDot } from '@/components/envelopes/send/step-recipients';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { AUTH_LABELS, ROLE_OPTIONS } from '@/lib/envelopes';
import { MESSAGE_MAX, TITLE_MAX } from '@/lib/send-flow';
import {
  emptyPerson,
  envelopeTitle,
  sendProblems,
  type People,
  type Person,
  type TemplateDefinition,
} from '@/lib/templates';
import { sendTemplateAction } from '@/server/actions/templates';
import { roleColor } from './step-roles';

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

/** Fills each role with a person and sends one envelope from the template. */
export function SendTemplateForm({
  slug,
  workspaceId,
  template,
  me,
}: {
  slug: string;
  workspaceId: string;
  template: { id: string; name: string; definition: TemplateDefinition };
  me: { name: string; email: string };
}) {
  const router = useRouter();
  const { definition } = template;
  const [people, setPeople] = useState<People>(() =>
    Object.fromEntries(definition.roles.map((r) => [r.id, emptyPerson()])),
  );
  const [title, setTitle] = useState(envelopeTitle(template.name, definition));
  const [message, setMessage] = useState(definition.message);
  const [shown, setShown] = useState(false);
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const live = useMemo(
    () => sendProblems(definition, people, { title, message }),
    [definition, people, title, message],
  );
  const problems = { ...(shown ? live : {}), ...serverProblems };
  const meUsed = Object.values(people).some(
    (p) => p.email.trim().toLowerCase() === me.email.toLowerCase(),
  );

  const set = (roleId: string, patch: Partial<Person>) => {
    setServerProblems({});
    setPeople((all) => ({ ...all, [roleId]: { ...(all[roleId] ?? emptyPerson()), ...patch } }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(live).length > 0) {
      setShown(true);
      const first = Object.keys(live)[0]!;
      document.querySelector<HTMLElement>(`[data-problem="${first}"] input`)?.focus();
      return;
    }
    setSending(true);
    try {
      const result = await sendTemplateAction({
        workspaceId,
        templateId: template.id,
        people,
        title,
        message,
      });
      if (!result.ok) {
        if (result.field) setServerProblems({ [result.field]: result.error });
        toast.error(result.error);
        return;
      }
      const first = definition.roles.find((r) => r.type !== 'viewer');
      toast.success(
        definition.routing === 'sequential' && first
          ? `Sent. ${people[first.id]?.name.trim()} gets the signing link now.`
          : 'Sent. Everyone gets their signing link now.',
      );
      router.push(`/w/${slug}/envelopes/${result.data.envelopeId}`);
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 pb-24 sm:pb-0 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <ol className="space-y-3" aria-label="Who takes each role">
          {definition.roles.map((role, i) => {
            const at = `people.${role.id}`;
            const person = people[role.id] ?? emptyPerson();
            return (
              <li
                key={role.id}
                className="rounded-xl border border-line bg-surface p-4 shadow-card"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-[3px] bg-surface-2 px-1.5 font-mono text-[11px] font-semibold text-ink">
                    {definition.routing === 'sequential' ? i + 1 : '•'}
                  </span>
                  <RecipientDot index={roleColor(definition.roles, role.id)} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{role.name}</span>
                  <span className="text-xs text-muted">
                    {ROLE_LABEL[role.type]}
                    {role.type !== 'viewer' ? ` · ${AUTH_LABELS[role.auth]}` : ''}
                  </span>
                  {meUsed ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => set(role.id, { name: me.name, email: me.email })}
                    >
                      <UserRound aria-hidden className="h-4 w-4" />
                      Me
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div data-problem={`${at}.name`}>
                    <Field label={`${role.name} name`} error={problems[`${at}.name`]}>
                      {(props) => (
                        <Input
                          {...props}
                          value={person.name}
                          autoComplete="off"
                          onChange={(e) => set(role.id, { name: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                  <div data-problem={`${at}.email`}>
                    <Field label={`${role.name} email`} error={problems[`${at}.email`]}>
                      {(props) => (
                        <Input
                          {...props}
                          type="email"
                          inputMode="email"
                          autoComplete="off"
                          value={person.email}
                          onChange={(e) => set(role.id, { email: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                  {role.auth === 'sms_otp' && role.type !== 'viewer' ? (
                    <div data-problem={`${at}.phone`}>
                      <Field
                        label={`${role.name} mobile`}
                        hint="With the country code, for example +919812345678."
                        error={problems[`${at}.phone`]}
                      >
                        {(props) => (
                          <Input
                            {...props}
                            type="tel"
                            inputMode="tel"
                            value={person.phone}
                            onChange={(e) => set(role.id, { phone: e.target.value })}
                          />
                        )}
                      </Field>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="The email" description="Prefilled from the template." />
          <div className="space-y-4 px-5 py-5">
            <div data-problem="title">
              <Field label="Title" hint="Also the email subject." error={problems.title}>
                {(props) => (
                  <Input
                    {...props}
                    value={title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Message (optional)" error={problems.message}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  value={message}
                  maxLength={MESSAGE_MAX}
                  onChange={(e) => setMessage(e.target.value)}
                />
              )}
            </Field>
          </div>
        </Card>
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button asChild variant="ghost">
            <Link href={`/w/${slug}/templates`}>Cancel</Link>
          </Button>
          <Button type="submit" pending={sending}>
            {sending ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Send aria-hidden className="h-4 w-4" />
            )}
            {sending ? 'Sending…' : 'Send now'}
          </Button>
        </div>
      </div>
    </form>
  );
}
