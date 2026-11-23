import type { MetadataRoute } from 'next';
import { CLIPS, posterOf } from '@/components/marketing/clips';
import { env } from '@/server/env';
import { isHosted } from '@/server/plans';

export const dynamic = 'force-dynamic';

/** The public pages of the hosted cloud; the docs keep their own sitemap under /docs. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isHosted()) return [];
  const appUrl = env().APP_URL;
  return [
    {
      url: `${appUrl}/`,
      changeFrequency: 'weekly',
      priority: 1,
      images: [`${appUrl}${posterOf(CLIPS.hero)}`],
      videos: Object.values(CLIPS).map((clip) => ({
        title: `Codevibe Sign: ${clip.label}`,
        description: `A short silent clip of Codevibe Sign: ${clip.label}.`,
        thumbnail_loc: `${appUrl}${posterOf(clip)}`,
        content_loc: `${appUrl}/home/${clip.name}.mp4`,
      })),
    },
    { url: `${appUrl}/docs`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${appUrl}/verify`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${appUrl}/install-help`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${appUrl}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${appUrl}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
