export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const RAZORPAY_CHECKOUT = 'https://checkout.razorpay.com';
const RAZORPAY_API = 'https://api.razorpay.com';
const TURNSTILE = 'https://challenges.cloudflare.com';

/**
 * The Content-Security-Policy for every page. Scripts, styles, fonts, images and connections
 * come from the app's own origin only. Next.js starts pages with inline scripts and the UI sets
 * inline styles, so both stay allowed inline; what the policy stops is code or data being
 * loaded from, or sent to, anywhere else, and the app being framed. The docs under `/docs`
 * serve their own fonts too. Razorpay Checkout is the one outside script: it is loaded when
 * someone pays and runs its payment form in a frame on Razorpay's own origin. Cloudflare
 * Turnstile, the optional human check on public forms, runs the same way from its own origin.
 */
export function contentSecurityPolicy({ development }: { development: boolean }): string {
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      [
        "'self'",
        "'unsafe-inline'",
        "'wasm-unsafe-eval'",
        ...(development ? ["'unsafe-eval'"] : []),
        RAZORPAY_CHECKOUT,
        TURNSTILE,
      ],
    ],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'self'", RAZORPAY_API, RAZORPAY_CHECKOUT, TURNSTILE]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/**
 * Paths that carry, or are reached from, a link that works like a password: a signing link, a
 * password reset link or an invitation. They send no referrer at all.
 */
const SECRET_LINK_PATHS = [
  '/sign',
  '/api/sign/:path*',
  '/api/v1/sign/:path*',
  '/reset-password',
  '/api/auth/reset-password/:path*',
  '/invite/:path*',
];

/**
 * Response headers for `next.config.ts`. Later rules win for the same header, so the secret-link
 * paths come after the rule for every path.
 */
export function headerRules(options: { development: boolean }): HeaderRule[] {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        // Browsers only take this over HTTPS, so a plain-HTTP install is not affected.
        ...(options.development
          ? []
          : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]),
      ],
    },
    ...SECRET_LINK_PATHS.map((source) => ({
      source,
      headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
    })),
    {
      // Public record pages: reachable by whoever holds the link, never listed or passed on.
      source: '/r/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    },
  ];
}
