import type { MetadataRoute } from 'next';
import { env } from '@/server/env';
import { isHosted } from '@/server/plans';

export const dynamic = 'force-dynamic';

/** The public pages of the hosted cloud; the docs keep their own sitemap under /docs. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isHosted()) return [];
  const appUrl = env().APP_URL;
  return [
    { url: `${appUrl}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${appUrl}/docs`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${appUrl}/verify`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${appUrl}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${appUrl}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
