export const THEMES = ['system', 'light', 'dark'] as const;
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

export function timeZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return supported ? supported('timeZone') : ['UTC'];
}
