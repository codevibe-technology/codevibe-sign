// Draws every icon of the web app and the docs from the one logo file, apps/site/public/mark.svg:
// `pnpm --filter web brand:icons`. Run it after changing the logo and commit what it writes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const NAVY = '#0D1B2A';
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const source = readFileSync(path('../../site/public/mark.svg'));

function write(file: string, bytes: Uint8Array | string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  console.log(`wrote ${file.slice(path('../../../').length)}`);
}

/** The mark alone on a clear background, for browser tabs. */
const bare = (size: number) =>
  sharp(source, { density: (72 * size) / 64 })
    .resize(size, size)
    .png()
    .toBuffer();

/** The mark on a navy tile with room around it, for home screens, which crop and round icons. */
async function tile(size: number) {
  const inner = Math.round(size * 0.6);
  const mark = await sharp(source, { density: (72 * inner) / 64 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** An .ico that holds each size as a PNG, which every current browser reads. */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const favicon = ico(
  await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await bare(size) }))),
);
const [apple, icon192, icon512] = await Promise.all([tile(180), tile(192), tile(512)]);

const manifest = (base: string) =>
  `${JSON.stringify(
    {
      name: 'Codevibe Sign',
      short_name: 'Sign',
      start_url: base,
      display: 'standalone',
      background_color: NAVY,
      theme_color: NAVY,
      icons: [192, 512].flatMap((size) =>
        ['any', 'maskable'].map((purpose) => ({
          src: `${base}icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: 'image/png',
          purpose,
        })),
      ),
    },
    null,
    2,
  )}\n`;

write(path('../public/mark.svg'), source);
write(path('../src/app/icon.svg'), source);
write(path('../src/app/favicon.ico'), favicon);
write(path('../src/app/apple-icon.png'), apple);
write(path('../public/icon-192.png'), icon192);
write(path('../public/icon-512.png'), icon512);

write(path('../../site/public/favicon.svg'), source);
write(path('../../site/public/favicon.ico'), favicon);
write(path('../../site/public/apple-touch-icon.png'), apple);
write(path('../../site/public/icon-192.png'), icon192);
write(path('../../site/public/icon-512.png'), icon512);
write(path('../../site/public/site.webmanifest'), manifest('/docs/'));

const module = path('../src/lib/brand-assets.ts');
const text = readFileSync(module, 'utf8');
const mark = source.toString('utf8').trim();
if (mark.includes("'")) throw new Error('mark.svg must not contain single quotes');
write(module, text.replace(/(export const MARK_SVG =\n {2}')[^']*(';)/, `$1${mark}$2`));
