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
  // Node-only packages are loaded at runtime, not bundled. Turbopack applies this only to
  // packages it finds under node_modules: in this repo the sign packages link to packages/*
  // and are bundled anyway, which they support; installed from npm they stay external.
  serverExternalPackages: [
    '@codevibe_technology/sign-server',
    '@codevibe_technology/sign-pdf',
    'postgres',
    'nodemailer',
  ],
  experimental: {
    // Uploading a PDF to check it (send flow, verify page) posts the file to a server action,
    // through the request proxy. 21 MB fits the 20 MB PDF limit plus the form around it.
    serverActions: { bodySizeLimit: '21mb' },
    proxyClientMaxBodySize: '21mb',
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
