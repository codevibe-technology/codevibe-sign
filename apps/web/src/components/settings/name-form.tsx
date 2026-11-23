'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { PERSON_NAME_MAX, personNameProblem } from '@/lib/person-name';
import { updateNameAction } from '@/server/actions/personal';
import { useAction } from './use-action';

export function NameForm({ user }: { user: { name: string; email: string } }) {
  const [saved, setSaved] = useState(user.name);
  const [name, setName] = useState(user.name);
  const [problem, setProblem] = useState<string | null>(null);
  const { pending, errors, run } = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = personNameProblem(name);
    setProblem(found);
    if (found) return;
    run(() => updateNameAction({ name }), {
      success: 'Your name is saved',
      onSuccess: (data) => {
        setSaved(data.name);
        setName(data.name);
      },
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Your name"
          description={`Shown to your team, on what you send and in the audit trail. You sign in as ${user.email}.`}
        />
        <CardBody>
          <Field
            label="Your name"
            hint="Your full name, as colleagues and signers should see it."
            error={problem ?? errors.name}
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
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={pending} disabled={name.trim() === saved}>
            Save name
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
