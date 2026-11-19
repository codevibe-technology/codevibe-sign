import type { Theme } from '@/lib/preferences';

/** Switches the page's theme at once, before the saved preference round-trips. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}
