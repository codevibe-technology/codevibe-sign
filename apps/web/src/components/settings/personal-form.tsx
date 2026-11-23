'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { applyTheme } from '@/components/shell/theme';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, NativeSelect } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { displayName } from '@/lib/person-name';
import type { Preferences, Theme } from '@/lib/preferences';
import { updatePreferencesAction } from '@/server/actions/personal';
import { TimeZoneSelect } from './time-zone-select';
import { useAction } from './use-action';

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match my device', icon: Monitor },
];

export function PersonalForm({
  user,
  preferences,
}: {
  user: { name: string; email: string };
  preferences: Preferences;
}) {
  const [theme, setTheme] = useState<Theme>(preferences.theme);
  const [timezone, setTimezone] = useState(preferences.timezone ?? '');
  const { pending, errors, run } = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    run(() => updatePreferencesAction({ theme, timezone }), { success: 'Preferences saved' });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Personal"
          description={`Only for you, ${displayName(user)}. Applies in every workspace.`}
        />
        <CardBody className="space-y-6">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Theme</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                    theme === value
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-line-strong hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => {
                      setTheme(value);
                      applyTheme(value);
                    }}
                    className="sr-only"
                  />
                  <Icon aria-hidden className="h-4 w-4" /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <Field
            label="Time zone"
            hint="Dates and times in the app are shown in this zone, with the zone named. Documents are dated in the workspace time zone."
            error={errors.timezone}
          >
            {(props) => (
              <TimeZoneSelect
                {...props}
                value={timezone}
                onChange={setTimezone}
                blank="Match my device"
              />
            )}
          </Field>
          <Field label="Language" hint="More languages are on the way.">
            {(props) => (
              <NativeSelect {...props} value="en" disabled>
                <option value="en">English</option>
              </NativeSelect>
            )}
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={pending}>
            Save preferences
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
