'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { PERSON_NAME_MAX, personNameProblem } from '@/lib/person-name';
import { acceptInvitationAction } from '@/server/actions/team';

/**
 * Accepts the invitation for the signed-in person. Someone who has saved no name yet gives it
 * here, starting from what the inviter typed.
 */
export function AcceptInvitation({
  token,
  askName = false,
  suggestedName = '',
}: {
  token: string;
  askName?: boolean;
  suggestedName?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = askName ? personNameProblem(name) : null;
    setProblem(found);
    if (found) return;
    start(async () => {
      const result = await acceptInvitationAction({ token, ...(askName ? { name } : {}) });
      if (result.ok) {
        toast.success('Welcome aboard');
        router.push(`/dashboard/${result.data.workspaceSlug}`);
      } else if (result.field === 'name') setProblem(result.error);
      else toast.error(result.error);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {askName ? (
        <div className="text-left">
          <Field
            label="Your name"
            hint="Your full name, as the team will see it."
            error={problem ?? undefined}
          >
            {(props) => (
              <Input
                {...props}
                name="name"
                autoComplete="name"
                maxLength={PERSON_NAME_MAX}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setProblem(null);
                }}
              />
            )}
          </Field>
        </div>
      ) : null}
      <Button type="submit" pending={pending}>
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
    </form>
  );
}
