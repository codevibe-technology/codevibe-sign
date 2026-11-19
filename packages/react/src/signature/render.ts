import { drawStrokes, type Stroke } from './strokes';
import { encodeSignature, type EncodeOptions } from './image';

export interface SignatureFont {
  /** Shown in the font picker. */
  label: string;
  /** A CSS font-family list. Load any web font yourself; none ship with this package. */
  family: string;
}

/** Handwriting faces common on desktop and mobile systems, each ending in a generic fallback. */
export const defaultSignatureFonts: SignatureFont[] = [
  {
    label: 'Flowing',
    family: '"Snell Roundhand", "Segoe Script", "Brush Script MT", "URW Chancery L", cursive',
  },
  {
    label: 'Casual',
    family: '"Bradley Hand", "Segoe Print", "Comic Neue", "Chalkboard SE", cursive',
  },
  {
    label: 'Formal',
    family: '"Apple Chancery", "Lucida Handwriting", "URW Chancery L", "Palatino Linotype", serif',
  },
];

export interface PenColor {
  label: string;
  value: string;
}

export const defaultPenColors: PenColor[] = [
  { label: 'Black', value: '#111111' },
  { label: 'Blue', value: '#1d3fae' },
  { label: 'Violet', value: '#4c1d95' },
];

/** Pixel size of the canvas a signature is composed on before trimming. */
export function exportSize(aspectRatio: number): { width: number; height: number } {
  const height = 400;
  return { width: Math.round(Math.min(4, Math.max(1, aspectRatio)) * height), height };
}

async function fontReady(font: string): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return;
  try {
    await fonts.load(font);
  } catch {
    // A font that fails to load falls back to the next family in the list.
  }
}

export async function renderTypedSignature(
  text: string,
  font: SignatureFont,
  color: string,
  aspectRatio: number,
  encode?: Partial<EncodeOptions>,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const { width, height } = exportSize(aspectRatio);
  let size = Math.round(height * 0.5);
  await fontReady(`${size}px ${font.family}`);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `${size}px ${font.family}`;
  const measured = ctx.measureText(trimmed).width;
  if (measured > width * 0.92) {
    size = Math.max(12, Math.floor((size * width * 0.92) / measured));
    ctx.font = `${size}px ${font.family}`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(trimmed, width / 2, height / 2);
  return encodeSignature(canvas, encode);
}

export function renderDrawnSignature(
  strokes: Stroke[],
  aspectRatio: number,
  encode?: Partial<EncodeOptions>,
): string | null {
  if (strokes.every((s) => s.points.length === 0)) return null;
  const { width, height } = exportSize(aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawStrokes(ctx, strokes, width, height);
  return encodeSignature(canvas, encode);
}
