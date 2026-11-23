export const BRAND_NAME = 'Codevibe Sign';
/** The brand's own colours, for icons and the share image. The app's tokens are in globals.css. */
export const BRAND_COLORS = { navy: '#0D1B2A', blue: '#1B6AE0', teal: '#2DD4BF' } as const;
/**
 * The lockup: the mark and "codevibe sign" in Poppins Medium, outlined to paths on the grid of
 * the codevibe.in logo (mark 122 units tall, words at 101.9 units with -0.035em tracking).
 * Poppins is never loaded as a font. The files live in `apps/site/public/brand`, copied to the
 * app by `pnpm --filter web brand:icons`.
 */
export const LOCKUP = {
  width: 823,
  height: 135,
  /** The logo, as the docs show it: navy "codevibe", blue "sign". */
  light: '/brand/logo.svg',
  /** The same lockup for dark surfaces only: white "codevibe", light blue "sign". */
  inverse: '/brand/logo-white.svg',
  /** The light lockup as a PNG for emails, at twice `EMAIL_LOGO`, with a thin white halo. */
  email: '/brand/logo-email.png',
  /** The inverse lockup as a PNG, for mail apps in dark mode. */
  emailDark: '/brand/logo-email-dark.png',
} as const;

/** The size emails draw the lockup at, in CSS pixels. */
export const EMAIL_LOGO = { width: 183, height: 30 } as const;

/** The only typefaces the app may load. */
export const BRAND_FONTS = ['Inter', 'Space Grotesk', 'JetBrains Mono'] as const;
