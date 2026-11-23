export const THEMES = ['system', 'light', 'dark'] as const;
/** What people see until they pick a theme themselves: light, whatever their device prefers. */
export const DEFAULT_THEME = 'light' satisfies (typeof THEMES)[number];
export type Theme = (typeof THEMES)[number];

export interface Preferences {
  theme: Theme;
  /** IANA name such as `Asia/Kolkata`; null until chosen, then the browser's is used. */
  timezone: string | null;
  locale: string;
}

/** Mirrors the saved theme so the first paint is already in it. */
export const THEME_COOKIE = 'cvs_theme';

export const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

export function isTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Names some runtimes still list under an older spelling, by that spelling. */
const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
};

/** Every IANA zone the runtime knows, under its current name, sorted, with UTC first. */
export function timeZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = new Set((supported ? supported('timeZone') : []).map((z) => RENAMED[z] ?? z));
  zones.delete('UTC');
  return ['UTC', ...[...zones].sort()];
}

/** The zones whose name or offset contains every word of `query`: "kol", "new york", "+5:30". */
export function searchTimeZones(zones: readonly string[], query: string, at?: Date): string[] {
  const words = query.toLowerCase().replaceAll('_', ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...zones];
  return zones.filter((zone) => {
    const label = zoneLabel(zone, at).toLowerCase();
    return words.every((word) => label.includes(word));
  });
}

/** `Asia/Kolkata`: a zone's name as people read it, the same on every machine. */
export const zoneName = (zone: string): string => zone.replaceAll('_', ' ');

/**
 * `Asia/Kolkata (GMT+5:30)`: a zone with its current offset from UTC, for lists and notes. The
 * offset's wording depends on the machine, so a server and a browser may not agree on it.
 */
export function zoneLabel(zone: string, at: Date = new Date()): string {
  const name = zone.replaceAll('_', ' ');
  try {
    const offset = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    return offset && offset !== name ? `${name} (${offset})` : name;
  } catch {
    return name;
  }
}
