'use client';

import { LocalTime } from '@/components/ui/local-time';
import { MailPlus, Trash2, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, canManageRole, type Role } from '@/lib/roles';
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from '@/server/actions/team';
import { useAction } from './use-action';

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export function TeamPanel({
  workspaceId,
  currentUserId,
  actorRole,
  members,
  invitations,
}: {
  workspaceId: string;
  currentUserId: string;
  actorRole: Role;
  members: TeamMember[];
  invitations: PendingInvitation[];
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const invite = useAction();
  const change = useAction();
  const assignable = [...ROLES].reverse().filter((r) => canManageRole(actorRole, r));

  function submit(event: FormEvent) {
    event.preventDefault();
    invite.run(() => inviteMemberAction({ workspaceId, email, role }), {
      onSuccess: (data) => {
        setEmail('');
        invite.clear();
        toast.success(`Invitation sent to ${data.email}`);
      },
    });
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Invite people"
          description="They get an email with a link that works for 7 days."
        />
        <CardBody>
          <form
            onSubmit={submit}
            noValidate
            className="grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-start"
          >
            <Field label="Email" error={invite.errors.email}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  placeholder="colleague@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Role" hint={ROLE_DESCRIPTIONS[role]} error={invite.errors.role}>
              {(props) => (
                <NativeSelect
                  {...props}
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {assignable.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Button type="submit" pending={invite.pending} className="sm:mt-7">
              <MailPlus aria-hidden className="h-4 w-4" /> Send invite
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Members"
          description={`${members.length} ${members.length === 1 ? 'person' : 'people'} in this workspace.`}
        />
        <ul className="divide-y divide-line">
          {members.map((member) => {
            const self = member.userId === currentUserId;
            const editable = !self && canManageRole(actorRole, member.role);
            return (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary">
                  {(member.name || member.email).slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {member.name || member.email}{' '}
                    {self ? <span className="text-muted">(you)</span> : null}
                  </p>
                  <p className="truncate text-sm text-muted">{member.email}</p>
                </div>
                {editable ? (
                  <>
                    <label className="sr-only" htmlFor={`role-${member.userId}`}>
                      Role of {member.name || member.email}
                    </label>
                    <div className="w-36">
                      <NativeSelect
                        id={`role-${member.userId}`}
                        value={member.role}
                        disabled={change.pending}
                        onChange={(e) =>
                          change.run(
                            () =>
                              changeRoleAction({
                                workspaceId,
                                userId: member.userId,
                                role: e.target.value,
                              }),
                            { success: 'Role changed' },
                          )
                        }
                      >
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${member.name || member.email}`}
                      disabled={change.pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${member.name || member.email} from this workspace?`,
                          )
                        ) {
                          change.run(
                            () => removeMemberAction({ workspaceId, userId: member.userId }),
                            {
                              success: 'Removed from the workspace',
                            },
                          );
                        }
                      }}
                    >
                      <UserMinus aria-hidden className="h-4 w-4 text-danger" />
                    </Button>
                  </>
                ) : (
                  <Badge tone={member.role === 'owner' ? 'accent' : 'neutral'}>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
        {change.errors.role ? (
          <p className="px-5 pb-3 text-sm text-danger" role="alert">
            {change.errors.role}
          </p>
        ) : null}
      </Card>

      {invitations.length ? (
        <Card>
          <CardHeader title="Waiting to join" />
          <ul className="divide-y divide-line">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{invitation.email}</p>
                  <p className="text-sm text-muted">
                    {ROLE_LABELS[invitation.role]} · expires{' '}
                    <LocalTime iso={invitation.expiresAt} format="day" />
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    change.run(
                      () => revokeInvitationAction({ workspaceId, invitationId: invitation.id }),
                      {
                        success: 'Invitation withdrawn',
                      },
                    )
                  }
                >
                  <Trash2 aria-hidden className="h-4 w-4" /> Withdraw
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
