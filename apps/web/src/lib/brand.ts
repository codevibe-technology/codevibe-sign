export const BRAND_FONTS = ['inter', 'space-grotesk', 'system', 'serif'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

export const BRAND_FONT_LABELS: Record<BrandFont, string> = {
  inter: 'Inter',
  'space-grotesk': 'Space Grotesk',
  system: 'System default',
  serif: 'Serif',
};

export const BRAND_FONT_STACKS: Record<BrandFont, string> = {
  inter: 'var(--font-inter), system-ui, sans-serif',
  'space-grotesk': 'var(--font-space-grotesk), system-ui, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

export const DEFAULT_BRAND_COLOR = '#1B6AE0';

export const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black text, whichever reads better on `background`. */
export function textOn(background: string): '#FFFFFF' | '#0D1B2A' {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#0D1B2A')
    ? '#FFFFFF'
    : '#0D1B2A';
}
