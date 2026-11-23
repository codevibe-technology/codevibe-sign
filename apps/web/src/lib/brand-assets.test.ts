import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_COLORS, BRAND_FONTS, LOCKUP } from './brand-assets';

const web = fileURLToPath(new URL('../../', import.meta.url));
const site = fileURLToPath(new URL('../../../site/', import.meta.url));
const pdf = fileURLToPath(new URL('../../../../packages/pdf/', import.meta.url));
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

const LOCKUPS = {
  'logo.svg': { word: '#0D1B2A', sign: '#1B6AE0', mark: null },
  'logo-white.svg': { word: '#FFFFFF', sign: '#2DD4BF', mark: null },
  'logo-mono.svg': { word: '#0D1B2A', sign: '#0D1B2A', mark: '#0D1B2A' },
  'logo-mono-white.svg': { word: '#FFFFFF', sign: '#FFFFFF', mark: '#FFFFFF' },
} as const;

/**
 * "codevibe" and "sign" outlined in Poppins Medium on the codevibe.in logo grid. Changing the
 * lockup means changing these on purpose.
 */
const WORD_HASHES = [
  '2fc43569a6e258da0b364a4c02f3e1ac1952f9d913b94ce9c9b774de01ab1f80',
  '387d304ab339a927c32b339e4924902cbbb6364b5248dd98107f7133ace3653d',
];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function parts(svg: string) {
  const group = /<g transform="scale\(([\d.]+)\)">(.*?)<\/g>/.exec(svg);
  const words = [
    ...svg.replace(group?.[0] ?? '', '').matchAll(/<path d="([^"]*)" fill="([^"]*)"\/>/g),
  ];
  return {
    viewBox: /viewBox="([^"]*)"/.exec(svg)?.[1],
    markScale: group?.[1],
    mark: group?.[2] ?? '',
    words: words.map((m) => ({ d: m[1]!, fill: m[2]! })),
  };
}

describe('the lockup', () => {
  const mark = /<svg[^>]*>(?:<title>[^<]*<\/title>)?(.*)<\/svg>/s.exec(
    text(site, 'public/mark.svg'),
  )![1]!;

  it('is the four colourways in the docs, copied unchanged to the app', () => {
    for (const name of Object.keys(LOCKUPS)) {
      expect(text(web, `public/brand/${name}`)).toBe(text(site, `public/brand/${name}`));
    }
  });

  it('is the mark and the outlined words on the codevibe.in grid, never a font', () => {
    for (const [name, colours] of Object.entries(LOCKUPS)) {
      const svg = text(site, `public/brand/${name}`);
      expect(svg).not.toMatch(/<text|font|@import|url\(/i);
      const lockup = parts(svg);
      expect(lockup.viewBox).toBe(`0 0 ${LOCKUP.width} ${LOCKUP.height}`);
      // The mark is drawn on a 512 grid and stands 122 units tall, as codevibe.in's mark does.
      expect(Number(lockup.markScale) * 512).toBeCloseTo(122, 2);
      const expectedMark = colours.mark
        ? mark.replace(/stroke="#[0-9A-Fa-f]{6}"/g, `stroke="${colours.mark}"`)
        : mark;
      expect(lockup.mark).toBe(expectedMark);
      expect(lockup.words.map((word) => sha256(word.d))).toEqual(WORD_HASHES);
      expect(lockup.words.map((word) => word.fill)).toEqual([colours.word, colours.sign]);
    }
  });

  it('is drawn from the same paths on the PDF certificate', () => {
    const lockup = parts(text(site, 'public/brand/logo.svg'));
    const paths = text(pdf, 'src/lockup-paths.ts');
    expect(paths).toContain(`width: ${LOCKUP.width},`);
    expect(paths).toContain(`height: ${LOCKUP.height},`);
    expect(paths).toContain(`markScale: ${lockup.markScale},`);
    for (const word of lockup.words) expect(paths).toContain(`d: '${word.d}'`);
    for (const [, d] of mark.matchAll(/d="([^"]*)"/g)) expect(paths).toContain(`d: '${d}'`);
  });

  it('is the logo wherever the app shows the name, in the version for the navy surfaces', () => {
    const wordmark = text(web, 'src/components/shell/brand-mark.tsx');
    expect(wordmark).toContain('src={LOCKUP.white}');
    expect(wordmark).not.toContain('{BRAND_NAME}</');
    for (const file of [
      'src/components/marketing/site-header.tsx',
      'src/components/marketing/site-footer.tsx',
      'src/components/records/public-shell.tsx',
      'src/components/shell/app-shell.tsx',
      'src/components/shell/status-page.tsx',
      'src/app/verify/page.tsx',
    ]) {
      expect(text(web, file)).toContain('<Wordmark');
    }
    expect(text(web, 'src/app/share-image.tsx')).toContain('LOCKUP.white');
    expect(text(web, 'src/server/mail.ts')).toContain('LOCKUP.email');
    expect(pngSize(read(web, `public${LOCKUP.email}`))[1]).toBe(56);
  });

  it('is the logo of the docs, light and dark, with no text title beside it', () => {
    const config = text(site, '.vitepress/config.ts');
    expect(config).toContain(
      "logo: { light: '/brand/logo.svg', dark: '/brand/logo-white.svg', alt: SITE_NAME }",
    );
    expect(config).toContain('siteTitle: false');
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

  it('are the same three in the docs, served by the docs themselves', () => {
    const config = text(site, '.vitepress/config.ts');
    expect(config).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    // Inter comes with the VitePress theme; the other two are files of the docs.
    expect(text(site, '.vitepress/theme/index.ts')).toContain("from 'vitepress/theme'");
    const style = text(site, '.vitepress/theme/style.css');
    const faces = [
      ...style.matchAll(
        /font-family: '([^']+)';\s+font-style[^}]*url\('\/fonts\/([\w-]+\.woff2)'\)/g,
      ),
    ];
    expect(new Set(faces.map((face) => face[1]))).toEqual(
      new Set(['Space Grotesk', 'JetBrains Mono']),
    );
    for (const [, , file] of faces)
      expect(existsSync(join(site, 'public/fonts', file!))).toBe(true);
    expect(style).toMatch(/font-display: swap/);
    expect(style).toContain("--vp-font-family-base: 'Inter',");
    expect(style).toContain("--vp-font-family-heading: 'Space Grotesk', 'Space Grotesk Fallback',");
    expect(style).toContain("--vp-font-family-mono: 'JetBrains Mono', 'JetBrains Mono Fallback',");
    expect([...BRAND_FONTS].sort()).toEqual(['Inter', 'JetBrains Mono', 'Space Grotesk']);
  });

  it('never include the face of the wordmark, which is outlined in the logo files', () => {
    const files = [
      ...sources(join(web, 'src')),
      join(site, '.vitepress/config.ts'),
      join(site, '.vitepress/theme/style.css'),
    ];
    const loads = /(font-family|family=|next\/font|@font-face)[^\n]*poppins|['"`]poppins|poppins_/i;
    expect(files.filter((file) => loads.test(readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('are set as on codevibe.in: bold tight headings, 0.2em mono eyebrows, display buttons', () => {
    const css = text(web, 'src/app/globals.css');
    expect(css).toMatch(/h1 \{\s+letter-spacing: -0\.03em;/);
    expect(css).toMatch(/h2 \{\s+letter-spacing: -0\.025em;/);
    expect(css).toMatch(/h3 \{\s+letter-spacing: -0\.02em;/);
    expect(css).toMatch(/\.eyebrow \{[^}]*letter-spacing: 0\.2em;/);
    expect(text(web, 'src/components/ui/button.tsx')).toContain('font-display font-semibold');
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
      expect(text(site, 'public/mark.svg').toLowerCase() + css).toContain(colour.toLowerCase());
  });
});
