'use client';

import { useEffect } from 'react';

/** Shows each `[data-reveal]` block once it comes into view; see `reveal`. */
export function RevealOnScroll() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const root = document.documentElement;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-shown', '');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const el of document.querySelectorAll('[data-reveal]:not([data-shown])')) {
      observer.observe(el);
    }
    root.setAttribute('data-reveal-ready', '');
    return () => {
      observer.disconnect();
      root.removeAttribute('data-reveal-ready');
    };
  }, []);
  return null;
}
