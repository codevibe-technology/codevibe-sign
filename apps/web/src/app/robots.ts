import type { MetadataRoute } from 'next';
import { env } from '@/server/env';
import { isHosted } from '@/server/plans';

export const dynamic = 'force-dynamic';

/** The hosted cloud lets search engines read its public pages and docs; installs stay private. */
export default function robots(): MetadataRoute.Robots {
  if (!isHosted()) return { rules: { userAgent: '*', disallow: '/' } };
  const appUrl = env().APP_URL;
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/dashboard/',
        '/api/',
        '/sign',
        '/invite/',
        '/transfer/',
        '/onboarding',
        '/brand/',
        '/r/',
        '/preview/',
      ],
    },
    sitemap: [`${appUrl}/sitemap.xml`, `${appUrl}/docs/sitemap.xml`],
  };
}
