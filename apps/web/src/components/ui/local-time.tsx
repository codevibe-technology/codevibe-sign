'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { formatDateTime, formatDay, relativeTime } from '@/lib/envelopes';
import { mailTime } from '@/lib/mail-log';

export type TimeFormat = 'full' | 'short' | 'day' | 'relative';

interface LocalTimeProps {
  iso: string;
  /**
   * `full`: 23 Nov 2026, 00:23 GMT+5:30. `short`: 00:23 GMT+5:30 today, with the day
   * otherwise. `day`: 23 Nov 2026. `relative`: 5 min ago, yesterday, 12 Mar.
   */
  format?: TimeFormat;
  className?: string;
  /** The current time, for tests. */
  now?: Date;
}

const ViewerZone = createContext<string | null>(null);

/**
 * The time zone the signed-in person chose in their personal settings, for every `LocalTime`
 * below. Without one, or outside the app, times follow the browser.
 */
export function ViewerTimeZone({ zone, children }: { zone: string | null; children: ReactNode }) {
  return <ViewerZone.Provider value={zone}>{children}</ViewerZone.Provider>;
}

function text(iso: string, format: TimeFormat, now: Date | undefined, timeZone?: string) {
  if (format === 'short') return mailTime(iso, now, timeZone);
  if (format === 'day') return formatDay(iso, timeZone);
  if (format === 'relative') return relativeTime(iso, now, timeZone);
  return formatDateTime(iso, timeZone);
}

/**
 * A date and time in the reader's own time zone, with the zone named: in the text where a
 * time of day is shown, and on hover for a bare day or "5 min ago". The server only knows the
 * zone of someone who saved one, so otherwise the HTML it sends says the time in UTC and the
 * browser swaps in the local time as soon as the page runs. Use it wherever a page shows a
 * date or time.
 */
export function LocalTime({ iso, format = 'full', className, now }: LocalTimeProps) {
  const chosen = useContext(ViewerZone);
  const [browser, setBrowser] = useState(false);
  useEffect(() => setBrowser(true), []);
  const zone = chosen ?? (browser ? undefined : 'UTC');
  const known = chosen !== null || browser;
  return (
    <time
      dateTime={iso}
      className={className}
      title={known && format !== 'full' ? formatDateTime(iso, zone) : undefined}
    >
      {text(iso, format, now, zone)}
    </time>
  );
}
