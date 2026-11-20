'use client';

import type { RoutingMode } from '@codevibe_technology/sign-core';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { RecipientDot } from '@/components/envelopes/send/step-recipients';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { AUTH_OPTIONS, ROLE_OPTIONS } from '@/lib/envelopes';
import { MAX_RECIPIENTS, moveItem, type Problems } from '@/lib/send-flow';
import { ROLE_NAME_MAX, newRole, type TemplateRoleDef } from '@/lib/templates';

const ROUTING = [
  ['sequential', 'One after another', 'Each role gets the link when the one before has finished.'],
  ['parallel', 'Everyone at once', 'Every role gets the link when it is sent.'],
] as const;

/** Index of a role's colour in the field placer: signers and approvers, in order. */
export function roleColor(roles: TemplateRoleDef[], id: string): number | null {
  const i = roles.filter((r) => r.type !== 'viewer').findIndex((r) => r.id === id);
  return i < 0 ? null : i % 6;
}

/** Step 2: the parts people play, named for what they are (Employee, HR), not who. */
export function StepRoles({
  roles,
  routing,
  problems,
  onChange,
  onRoutingChange,
}: {
  roles: TemplateRoleDef[];
  routing: RoutingMode;
  problems: Problems;
  onChange: (update: (roles: TemplateRoleDef[]) => TemplateRoleDef[]) => void;
  onRoutingChange: (routing: RoutingMode) => void;
}) {
  const update = (id: string, patch: Partial<TemplateRoleDef>) =>
    onChange((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm text-muted">
          Roles are filled with real people each time the template is sent. Name them for the part
          they play, for example <span className="font-semibold text-ink">Employee</span> and{' '}
          <span className="font-semibold text-ink">HR manager</span>.
        </p>
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Signing order</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {ROUTING.map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm',
                  routing === value ? 'border-primary bg-primary-soft' : 'border-line-strong',
                )}
              >
                <input
                  type="radio"
                  name="routing"
                  value={value}
                  checked={routing === value}
                  onChange={() => onRoutingChange(value)}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      {problems.roles ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {problems.roles}
        </p>
      ) : null}

      <ol className="space-y-3" aria-label="Roles">
        {roles.map((r, i) => {
          const label = r.name.trim() || `Role ${i + 1}`;
          return (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 min-w-6 items-center justify-center rounded-[3px] bg-surface-2 px-1.5 font-mono text-[11px] font-semibold text-ink">
                  {routing === 'sequential' ? i + 1 : '•'}
                </span>
                <RecipientDot index={roleColor(roles, r.id)} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${label} up`}
                  disabled={i === 0}
                  onClick={() => onChange((list) => moveItem(list, i, i - 1))}
                >
                  <ArrowUp aria-hidden className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${label} down`}
                  disabled={i === roles.length - 1}
                  onClick={() => onChange((list) => moveItem(list, i, i + 1))}
                >
                  <ArrowDown aria-hidden className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${label}`}
                  disabled={roles.length === 1}
                  onClick={() => onChange((list) => list.filter((x) => x.id !== r.id))}
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Role name" error={problems[`roles.${r.id}.name`]}>
                  {(props) => (
                    <Input
                      {...props}
                      value={r.name}
                      maxLength={ROLE_NAME_MAX}
                      autoComplete="off"
                      placeholder="Employee"
                      onChange={(e) => update(r.id, { name: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Does" hint={ROLE_OPTIONS.find((o) => o.value === r.type)?.hint}>
                  {(props) => (
                    <NativeSelect
                      {...props}
                      value={r.type}
                      onChange={(e) =>
                        update(r.id, { type: e.target.value as TemplateRoleDef['type'] })
                      }
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                {r.type === 'viewer' ? null : (
                  <Field label="Identity check">
                    {(props) => (
                      <NativeSelect
                        {...props}
                        value={r.auth}
                        onChange={(e) =>
                          update(r.id, { auth: e.target.value as TemplateRoleDef['auth'] })
                        }
                      >
                        {AUTH_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="secondary"
        disabled={roles.length >= MAX_RECIPIENTS}
        onClick={() => onChange((list) => [...list, newRole()])}
      >
        <Plus aria-hidden className="h-4 w-4" />
        Add role
      </Button>
    </div>
  );
}
