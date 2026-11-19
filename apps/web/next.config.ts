import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Node-only packages with native or dynamic requires are loaded at runtime, not bundled.
  serverExternalPackages: [
    '@codevibe_technology/sign-server',
    '@codevibe_technology/sign-pdf',
    'postgres',
    'nodemailer',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
