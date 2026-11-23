#!/usr/bin/env node
// Renders the README, package and docs images from the HTML in .github/assets/src at twice their
// CSS size, then shrinks the PNGs. The screenshots the pages use are in .github/assets/src/shots.
//
//   pnpm assets:build              every image
//   pnpm assets:build banner package-core  only the ones named
//
// It uses the installed Google Chrome, or Playwright's Chromium when Chrome is missing.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '.github/assets/src');
const out = join(root, '.github/assets');

const PACKAGES = [
  'codevibe-sign',
  'core',
  'pdf',
  'client',
  'react',
  'templates',
  'aadhaar',
  'server',
];

/** Each image: its page, where it goes, its CSS size and scale. */
const IMAGES = [
  { name: 'banner', page: 'banner.html', file: 'banner.png', width: 1280, height: 640 },
  {
    name: 'social-preview',
    page: 'banner.html',
    file: 'social-preview.png',
    width: 1280,
    height: 640,
    scale: 1,
    lossless: true,
  },
  {
    name: 'whats-inside',
    page: 'whats-inside.html',
    file: 'whats-inside.png',
    width: 1280,
    height: 720,
  },
  {
    name: 'how-it-works',
    page: 'how-it-works.html',
    file: 'how-it-works.png',
    width: 1280,
    height: 680,
  },
  { name: 'verify', page: 'verify.html', file: 'verify.png', width: 1280, height: 640 },
  { name: 'plans', page: 'plans.html', file: 'plans.png', width: 1280, height: 940 },
  { name: 'aadhaar', page: 'aadhaar.html', file: 'aadhaar.png', width: 1280, height: 680 },
  { name: 'licensing', page: 'licensing.html', file: 'licensing.png', width: 1280, height: 520 },
  ...PACKAGES.map((pkg) => ({
    name: `package-${pkg}`,
    page: `package.html?pkg=${pkg}`,
    file: `packages/${pkg}.png`,
    width: 1280,
    height: 400,
  })),
  {
    name: 'docs-og',
    svg: join(root, 'apps/site/assets/og.svg'),
    path: join(root, 'apps/site/public/og.png'),
    width: 1200,
    height: 630,
    scale: 1,
    lossless: true,
  },
];

/** Lucide icons as SVG markup, from the same package the app draws its icons with. */
const web = createRequire(join(root, 'apps/web/package.json'));
const React = web('react');
const { renderToStaticMarkup } = web('react-dom/server');
const lucide = web('lucide-react');
function icon(name) {
  const component = lucide[name];
  if (!component) throw new Error(`No lucide icon named ${name}`);
  return renderToStaticMarkup(React.createElement(component, { size: 22, strokeWidth: 2 }));
}

async function launch() {
  const args = ['--allow-file-access-from-files', '--font-render-hinting=none'];
  try {
    return await chromium.launch({ channel: 'chrome', args });
  } catch {
    return chromium.launch({ args });
  }
}

/** Waits for the fonts and images, then puts the icons in place. */
async function settle(page) {
  const names = await page.$$eval('[data-icon]', (els) => [
    ...new Set(els.map((e) => e.dataset.icon)),
  ]);
  const svgs = Object.fromEntries(names.map((name) => [name, icon(name)]));
  await page.$$eval(
    '[data-icon]',
    (els, markup) => els.forEach((e) => (e.innerHTML = markup[e.dataset.icon])),
    svgs,
  );
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    await Promise.all(
      [...globalThis.document.images].map((img) =>
        img.complete ? null : new Promise((resolve) => (img.onload = img.onerror = resolve)),
      ),
    );
  });
  const missing = await page.$$eval('img', (imgs) =>
    imgs.filter((img) => !img.naturalWidth).map((img) => img.getAttribute('src')),
  );
  if (missing.length) throw new Error(`Images did not load: ${missing.join(', ')}`);
}

/**
 * A palette PNG when it is smaller, otherwise the lossless one. Cards shown at their own size
 * stay lossless: at 1x the palette blurs small coloured dots.
 */
async function optimise(buffer, lossy) {
  const lossless = await sharp(buffer)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  if (!lossy) return lossless;
  const palette = await sharp(buffer)
    .png({ palette: true, quality: 92, effort: 10, dither: 0.6, compressionLevel: 9 })
    .toBuffer();
  return lossy && palette.length < lossless.length ? palette : lossless;
}

const only = process.argv.slice(2);
const chosen = only.length ? IMAGES.filter((image) => only.includes(image.name)) : IMAGES;
if (only.length && chosen.length !== only.length) {
  console.error(`Unknown image. Choose from: ${IMAGES.map((image) => image.name).join(', ')}`);
  process.exit(1);
}

const browser = await launch();
try {
  for (const image of chosen) {
    const scale = image.scale ?? 2;
    const page = await browser.newPage({
      viewport: { width: image.width, height: image.height },
      deviceScaleFactor: scale,
    });
    if (image.svg) {
      // The docs card is an SVG; it is drawn inside a page that has the brand fonts.
      await page.goto(pathToFileURL(join(src, 'svg.html')).href);
      await page.$eval('#svg', (el, svg) => (el.innerHTML = svg), readFileSync(image.svg, 'utf8'));
    } else {
      const [file, query] = image.page.split('?');
      await page.goto(pathToFileURL(join(src, file)).href + (query ? `?${query}` : ''));
    }
    await settle(page);
    const shot = await page.screenshot({
      clip: { x: 0, y: 0, width: image.width, height: image.height },
    });
    const target = image.path ?? join(out, image.file);
    const before = (() => {
      try {
        return statSync(target).size;
      } catch {
        return 0;
      }
    })();
    writeFileSync(target, await optimise(shot, !image.lossless));
    const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
    console.log(`${image.name}: ${kb(before)} -> ${kb(statSync(target).size)}`);
    await page.close();
  }
} finally {
  await browser.close();
}
