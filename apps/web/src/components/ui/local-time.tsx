'use client';

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/envelopes';
import { mailTime } from '@/lib/mail-log';

interface LocalTimeProps {
  iso: string;
  /** `full`: 23 Nov 2026, 00:23. `short`: 00:23 today, 3 Nov, 14:42 otherwise. */
  format?: 'full' | 'short';
  className?: string;
  /** The current time, for tests. */
  now?: Date;
}

const text = (iso: string, format: 'full' | 'short', now: Date | undefined, timeZone?: string) =>
  format === 'short' ? mailTime(iso, now, timeZone) : formatDateTime(iso, timeZone);

/**
 * A date and time in the reader's own time zone. The server does not know that zone, so the
 * HTML it sends says the time in UTC and names it; the browser swaps in the local time as soon
 * as the page runs. Use it wherever a server-rendered page shows a time of day.
 */
export function LocalTime({ iso, format = 'full', className, now }: LocalTimeProps) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(text(iso, format, now)), [iso, format, now]);
  return (
    <time dateTime={iso} className={className}>
      {local ?? `${text(iso, format, now, 'UTC')} UTC`}
    </time>
  );
}
