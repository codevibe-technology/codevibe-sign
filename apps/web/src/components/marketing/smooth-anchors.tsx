'use client';

import { useEffect } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The section id a link points at on this page, or null when it leads somewhere else. */
export function sectionTarget(anchor: HTMLAnchorElement, location: Location): string | null {
  const raw = anchor.getAttribute('href');
  if (!raw || anchor.target === '_blank' || anchor.hasAttribute('download')) return null;
  const url = new URL(raw, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) return null;
  const id = decodeURIComponent(url.hash.slice(1));
  return id ? id : null;
}

/**
 * Makes links to a section of this page glide there instead of jumping. The section's own
 * `scroll-margin-top` keeps its heading clear of the sticky header, the address keeps the
 * section's hash, and focus moves to the heading so keyboard and screen reader users carry on
 * reading from it. Visitors who ask for reduced motion get the jump.
 */
export function SmoothAnchors() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor) return;
      const id = sectionTarget(anchor, window.location);
      const section = id ? document.getElementById(id) : null;
      if (!section) return;
      event.preventDefault();
      const reduced = window.matchMedia?.(REDUCED_MOTION).matches ?? false;
      section.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
      if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
      const heading = section.matches('h1, h2, h3')
        ? section
        : section.querySelector<HTMLElement>('h2, h3');
      const focusTarget = heading ?? section;
      if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
