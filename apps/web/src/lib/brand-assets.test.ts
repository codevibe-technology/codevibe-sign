import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_COLORS, BRAND_FONTS, MARK_SVG } from './brand-assets';

const web = fileURLToPath(new URL('../../', import.meta.url));
const site = fileURLToPath(new URL('../../../site/', import.meta.url));
const read = (root: string, file: string) => readFileSync(join(root, file));
const text = (root: string, file: string) => read(root, file).toString('utf8');

/** Every source file under `dir`, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe('the logo', () => {
  const logo = text(site, 'public/mark.svg');

  it('is one file: the docs logo, copied unchanged wherever the app needs it', () => {
    expect(text(web, 'public/mark.svg')).toBe(logo);
    expect(text(web, 'src/app/icon.svg')).toBe(logo);
    expect(text(site, 'public/favicon.svg')).toBe(logo);
    expect(MARK_SVG).toBe(logo.trim());
    expect(text(site, '.vitepress/config.ts')).toContain("logo: { src: '/mark.svg'");
  });

  it('is never drawn a second time in the code', () => {
    const drawn = sources(join(web, 'src')).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        /M890 577V1508/.test(source) ||
        (/M58 130V478H382/.test(source) && !file.endsWith('brand-assets.ts'))
      );
    });
    expect(drawn).toEqual([]);
    const mark = text(web, 'src/components/shell/brand-mark.tsx');
    expect(mark).toContain('src="/mark.svg"');
    expect(mark).not.toContain('<svg');
  });

  it('has every icon size, drawn from it for the app and the docs alike', () => {
    for (const root of [join(web, 'src/app'), join(site, 'public')]) {
      const ico = read(root, 'favicon.ico');
      expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 3]);
      expect([0, 1, 2].map((i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
    }
    expect(pngSize(read(web, 'src/app/apple-icon.png'))).toEqual([180, 180]);
    expect(pngSize(read(site, 'public/apple-touch-icon.png'))).toEqual([180, 180]);
    for (const root of [join(web, 'public'), join(site, 'public')]) {
      expect(pngSize(read(root, 'icon-192.png'))).toEqual([192, 192]);
      expect(pngSize(read(root, 'icon-512.png'))).toEqual([512, 512]);
    }
    expect(read(web, 'src/app/favicon.ico').equals(read(site, 'public/favicon.ico'))).toBe(true);
    const manifest = JSON.parse(text(site, 'public/site.webmanifest')) as {
      icons: { src: string }[];
    };
    expect(new Set(manifest.icons.map((icon) => icon.src))).toEqual(
      new Set(['/docs/icon-192.png', '/docs/icon-512.png']),
    );
    expect(text(web, 'src/app/manifest.ts')).toContain('/icon-${size}.png');
  });
});

describe('the typefaces', () => {
  it('are the three brand families and nothing else, in the app', () => {
    const layout = text(web, 'src/app/layout.tsx');
    const loaded = /import \{([^}]+)\} from 'next\/font\/google'/.exec(layout)![1]!;
    expect(
      loaded
        .split(',')
        .map((name) => name.trim().replaceAll('_', ' '))
        .sort(),
    ).toEqual([...BRAND_FONTS].sort());
    const css = text(web, 'src/app/globals.css');
    expect(css).toContain('--font-sans: var(--font-inter),');
    expect(css).toContain('--font-display: var(--font-space-grotesk),');
    expect(css).toContain('--font-mono: var(--font-jetbrains-mono),');
  });

  it('are not overridden by a font named in a component', () => {
    // A workspace may pick the font of its own signing page and emails; that list lives in
    // lib/brand.ts. Everything else takes the tokens.
    const allowed = /(lib\/brand\.ts|lib\/brand-assets\.ts|app\/globals\.css)$/;
    const named = sources(join(web, 'src'))
      .filter((file) => !allowed.test(file))
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/font-?[fF]amily\s*[:=]\s*[`'"]?([^;`'"}\n]+)/g)]
          .map((match) => match[1]!.trim())
          .filter((value) => !/^(Inter\b|var\(|BRAND_FONT_STACKS|\{)/.test(value))
          .map((value) => `${file.slice(web.length)}: ${value}`),
      );
    expect(named).toEqual([]);
  });

  it('are the same three in the docs', () => {
    const config = text(site, '.vitepress/config.ts');
    const families = [...config.matchAll(/family=([A-Za-z+]+)/g)].map((m) =>
      m[1]!.replaceAll('+', ' '),
    );
    expect(families.sort()).toEqual([...BRAND_FONTS].sort());
    const style = text(site, '.vitepress/theme/style.css');
    expect(style).toContain("--vp-font-family-base: 'Inter',");
    expect(style).toContain("--vp-font-family-heading: 'Space Grotesk',");
    expect(style).toContain("--vp-font-family-mono: 'JetBrains Mono',");
  });
});

describe('the colours', () => {
  it('are the brand navy, blue and teal in the app and the docs', () => {
    const css = text(web, 'src/app/globals.css').toLowerCase();
    expect(css).toContain(`--primary: ${BRAND_COLORS.blue.toLowerCase()};`);
    expect(css).toContain(`--accent: ${BRAND_COLORS.teal.toLowerCase()};`);
    expect(css).toContain(`--nav: ${BRAND_COLORS.navy.toLowerCase()};`);
    const style = text(site, '.vitepress/theme/style.css').toLowerCase();
    expect(style).toContain(`--cv-navy: ${BRAND_COLORS.navy.toLowerCase()};`);
    expect(style).toContain(`--cv-blue: ${BRAND_COLORS.blue.toLowerCase()};`);
    expect(style).toContain(`--cv-teal: ${BRAND_COLORS.teal.toLowerCase()};`);
    for (const colour of Object.values(BRAND_COLORS))
      expect(MARK_SVG + css).toContain(colour.toLowerCase());
  });
});
