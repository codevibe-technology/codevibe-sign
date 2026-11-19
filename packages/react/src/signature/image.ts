import { MAX_IMAGE_BYTES, SignError } from '@codevibe_technology/sign-core';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BackgroundTest = (r: number, g: number, b: number, a: number) => boolean;

export const isTransparent: BackgroundTest = (_r, _g, _b, a) => a < 16;

/** Transparent or near-white: the paper behind a photographed or scanned signature. */
export const isPaper: BackgroundTest = (r, g, b, a) => a < 16 || (r > 225 && g > 225 && b > 225);

/** Smallest box holding every non-background pixel, or null when the image is blank. */
export function findContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  isBackground: BackgroundTest = isTransparent,
): Bounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isBackground(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Makes background pixels fully transparent, in place. */
export function clearBackground(data: Uint8ClampedArray, isBackground: BackgroundTest): void {
  for (let i = 0; i < data.length; i += 4) {
    if (isBackground(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) data[i + 3] = 0;
  }
}

/** Scales a size down (never up) to fit inside the limits, keeping its aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Decoded size of a base64 string, in bytes. */
export function base64Size(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface EncodeOptions {
  /** Largest output width in pixels. */
  maxWidth: number;
  /** Largest output height in pixels. */
  maxHeight: number;
  /** Largest PNG in bytes; the image is scaled down until it fits. Never above core's MAX_IMAGE_BYTES. */
  maxBytes: number;
  /** Transparent margin kept around the trimmed content, in pixels of the source. */
  padding: number;
  isBackground: BackgroundTest;
  /** Turn background pixels transparent before encoding (for photos of paper). */
  removeBackground: boolean;
}

export const defaultEncodeOptions: EncodeOptions = {
  maxWidth: 1200,
  maxHeight: 400,
  maxBytes: 200_000,
  padding: 8,
  isBackground: isTransparent,
  removeBackground: false,
};

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new SignError('VALIDATION', 'Canvas 2D is not available.', { reason: 'canvas' });
  return ctx;
}

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Trims a canvas to its content, scales it to the limits and encodes it as PNG.
 * Returns base64 without the data URL prefix, or null when the canvas is blank.
 */
export function encodeSignature(
  source: HTMLCanvasElement,
  options: Partial<EncodeOptions> = {},
): string | null {
  const opts = { ...defaultEncodeOptions, ...options };
  const maxBytes = Math.min(opts.maxBytes, MAX_IMAGE_BYTES);
  const ctx = context2d(source);
  const image = ctx.getImageData(0, 0, source.width, source.height);
  const bounds = findContentBounds(image.data, source.width, source.height, opts.isBackground);
  if (!bounds) return null;

  let pixels: CanvasImageSource = source;
  if (opts.removeBackground) {
    clearBackground(image.data, opts.isBackground);
    const cleaned = document.createElement('canvas');
    cleaned.width = source.width;
    cleaned.height = source.height;
    context2d(cleaned).putImageData(image, 0, 0);
    pixels = cleaned;
  }

  const pad = opts.padding;
  const sx = Math.max(0, bounds.x - pad);
  const sy = Math.max(0, bounds.y - pad);
  const sw = Math.min(source.width, bounds.x + bounds.width + pad) - sx;
  const sh = Math.min(source.height, bounds.y + bounds.height + pad) - sy;

  let size = fitWithin(sw, sh, opts.maxWidth, opts.maxHeight);
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = document.createElement('canvas');
    out.width = size.width;
    out.height = size.height;
    const outCtx = context2d(out);
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(pixels, sx, sy, sw, sh, 0, 0, size.width, size.height);
    const base64 = stripDataUrl(out.toDataURL('image/png'));
    if (base64Size(base64) <= maxBytes) return base64;
    size = {
      width: Math.max(1, Math.round(size.width * 0.75)),
      height: Math.max(1, Math.round(size.height * 0.75)),
    };
  }
  throw new SignError('VALIDATION', 'The signature image is too large.', { reason: 'too_large' });
}

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export interface UploadOptions extends Partial<EncodeOptions> {
  /** Largest file accepted before decoding, in bytes. */
  maxFileBytes?: number;
}

async function decodeImage(
  file: Blob,
): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Re-encodes an uploaded signature image: decodes it, drops the paper background,
 * trims it and writes a size-capped PNG. Never passes the original bytes through.
 */
export async function imageFileToSignature(
  file: Blob,
  options: UploadOptions = {},
): Promise<string> {
  const { maxFileBytes = 5_000_000, ...encode } = options;
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new SignError('VALIDATION', 'Choose a PNG, JPEG or WebP image.', { reason: 'not_image' });
  }
  if (file.size > maxFileBytes) {
    throw new SignError('VALIDATION', 'The image file is too large.', { reason: 'file_too_large' });
  }

  let image: CanvasImageSource & { width: number; height: number };
  try {
    image = await decodeImage(file);
  } catch (cause) {
    throw new SignError('VALIDATION', 'The image could not be read.', {
      reason: 'unreadable',
      cause: String(cause),
    });
  }

  // Decode at a bounded size so a huge photo does not exhaust memory while trimming.
  const work = fitWithin(image.width, image.height, 2400, 2400);
  const canvas = document.createElement('canvas');
  canvas.width = work.width;
  canvas.height = work.height;
  context2d(canvas).drawImage(image, 0, 0, work.width, work.height);
  if ('close' in image && typeof image.close === 'function') image.close();

  const base64 = encodeSignature(canvas, {
    isBackground: isPaper,
    removeBackground: true,
    ...encode,
  });
  if (!base64) {
    throw new SignError('VALIDATION', 'No signature was found in the image.', { reason: 'blank' });
  }
  return base64;
}
