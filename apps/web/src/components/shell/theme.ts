import type { Theme } from '@/lib/preferences';

/**
 * Switches the page's theme at once, before the saved preference round-trips. Where the
 * browser can, the old and new colours cross-fade instead of flipping.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const swap = () => {
    root.dataset.theme = theme;
  };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced || typeof document.startViewTransition !== 'function') {
    swap();
    return;
  }
  document.startViewTransition(swap);
}
