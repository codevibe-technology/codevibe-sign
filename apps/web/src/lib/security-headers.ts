export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/**
 * The Content-Security-Policy for every page. Scripts, styles, fonts, images and connections
 * come from the app's own origin only. Next.js starts pages with inline scripts and the UI sets
 * inline styles, so both stay allowed inline; what the policy stops is code or data being
 * loaded from, or sent to, anywhere else, and the app being framed. The docs under `/docs`
 * load their fonts from Google Fonts.
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
      ],
    ],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com']],
    ['connect-src', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'self'"]],
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
