/**
 * The Codevibe Sign mark, for the places that cannot load `/mark.svg` (the share image). The
 * one source is `apps/site/public/mark.svg`, the logo of the docs; `pnpm --filter web
 * brand:icons` copies it here and draws every icon from it, and a test fails when any copy
 * drifts.
 */
export const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Codevibe Sign"><title>Codevibe Sign</title><path d="M58 130V478H382" fill="none" stroke="#1B6AE0" stroke-width="48" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M128 372C164 300 196 236 222 262C246 286 202 352 240 352C272 352 286 292 314 298C334 302 330 340 356 340" fill="none" stroke="#2DD4BF" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/><path d="M255 34H466V245" fill="none" stroke="#1B6AE0" stroke-width="48" stroke-linecap="butt" stroke-linejoin="miter"/></svg>';

export const BRAND_NAME = 'Codevibe Sign';
/** The brand's own colours, for icons and the share image. The app's tokens are in globals.css. */
export const BRAND_COLORS = { navy: '#0D1B2A', blue: '#1B6AE0', teal: '#2DD4BF' } as const;
/** The only typefaces the app may load. */
export const BRAND_FONTS = ['Inter', 'Space Grotesk', 'JetBrains Mono'] as const;
