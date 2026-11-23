'use client';

import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Input, NativeSelect } from '@/components/ui/field';
import { useHydrated } from '@/components/ui/use-hydrated';
import { searchTimeZones, timeZones, zoneLabel, zoneName } from '@/lib/preferences';

interface TimeZoneSelectProps {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  /** A first choice that is not a zone, for example "Match my device", with value `''`. */
  blank?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/**
 * Every IANA time zone with its current offset, and a box that narrows the list by city,
 * region or offset. The chosen zone stays in the list whatever is typed.
 */
export function TimeZoneSelect({ id, value, onChange, blank, ...aria }: TimeZoneSelectProps) {
  const [query, setQuery] = useState('');
  // The server's offsets may be worded differently from the browser's; names come first.
  const hydrated = useHydrated();
  // The list comes from the browser, so the first paint only has the saved zone.
  const [zones, setZones] = useState<string[]>(value ? [value] : []);
  useEffect(() => setZones(timeZones()), []);

  const shown = useMemo(() => {
    const found = searchTimeZones(zones, query);
    return value && !found.includes(value) ? [value, ...found] : found;
  }, [zones, query, value]);
  const matches = query.trim() ? searchTimeZones(zones, query).length : null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
        />
        <Input
          type="search"
          className="pl-9"
          aria-label="Search time zones"
          aria-controls={id}
          placeholder="Search by city, region or offset"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} {...aria}>
        {blank ? <option value="">{blank}</option> : null}
        {shown.map((zone) => (
          <option key={zone} value={zone}>
            {hydrated ? zoneLabel(zone) : zoneName(zone)}
          </option>
        ))}
      </NativeSelect>
      <p className="sr-only" role="status">
        {matches === null ? '' : `${matches} ${matches === 1 ? 'time zone' : 'time zones'} found`}
      </p>
    </div>
  );
}
