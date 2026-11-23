import type { CSSProperties } from 'react';

/**
 * Marks a block to fade and rise into place the first time it scrolls into view. `order`
 * staggers blocks that enter together, one short beat each. Nothing is hidden until
 * `RevealOnScroll` runs, so the page reads the same without JavaScript, and with reduced
 * motion nothing moves at all.
 */
export const reveal = (order = 0) => ({
  'data-reveal': '',
  style: { '--reveal-order': order } as CSSProperties,
});
