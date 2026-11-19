'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { applyTheme } from '@/components/shell/theme';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, NativeSelect } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { timeZones, type Preferences, type Theme } from '@/lib/preferences';
import { updatePreferencesAction } from '@/server/actions/personal';
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
  const [zones, setZones] = useState<string[]>(preferences.timezone ? [preferences.timezone] : []);
  const { pending, errors, run } = useAction();

  useEffect(() => {
    setZones(timeZones());
    if (!preferences.timezone) setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [preferences.timezone]);

  function submit(event: FormEvent) {
    event.preventDefault();
    run(() => updatePreferencesAction({ theme, timezone }), { success: 'Preferences saved' });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Personal"
          description={`Only for you, ${user.name || user.email}. Applies in every workspace.`}
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
            hint="Dates and times in the app are shown in this zone."
            error={errors.timezone}
          >
            {(props) => (
              <NativeSelect
                {...props}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll('_', ' ')}
                  </option>
                ))}
              </NativeSelect>
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
