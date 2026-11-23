import type { NextConfig } from 'next';
import { headerRules } from './src/lib/security-headers';

const config: NextConfig = {
  // The Docker image runs the self-contained server; `next start` keeps working without it.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
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
  // The app used to live under /w; links in old emails and bookmarks still arrive there.
  async redirects() {
    return [
      { source: '/w', destination: '/dashboard', permanent: true },
      { source: '/w/:path*', destination: '/dashboard/:path*', permanent: true },
    ];
  },
  async headers() {
    return headerRules({ development: process.env.NODE_ENV === 'development' });
  },
};

export default config;
