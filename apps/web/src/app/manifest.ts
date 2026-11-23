import type { MetadataRoute } from 'next';
import { BRAND_COLORS, BRAND_NAME } from '@/lib/brand-assets';

const icon = (size: 192 | 512, purpose: 'any' | 'maskable') => ({
  src: `/icon-${size}.png`,
  sizes: `${size}x${size}`,
  type: 'image/png',
  purpose,
});

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: 'Sign',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: BRAND_COLORS.navy,
    theme_color: BRAND_COLORS.navy,
    icons: [icon(192, 'any'), icon(192, 'maskable'), icon(512, 'any'), icon(512, 'maskable')],
  };
}
