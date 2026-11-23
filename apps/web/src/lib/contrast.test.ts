import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** The colour tokens declared in the block that starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const found: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)) {
    found[name!] = value!;
  }
  return found;
}

const light = tokens(":root,\n[data-theme='light']");
const dark = tokens("[data-theme='dark'] {");
const system = { ...light, ...tokens("[data-theme='system'] {") };

const TEXT = ['ink', 'muted', 'primary-text', 'danger-text', 'success-text', 'warning'];
const BACKGROUNDS = [
  'canvas',
  'surface',
  'surface-2',
  'primary-soft',
  'accent-soft',
  'danger-soft',
  'success-soft',
  'warning-soft',
];
/** Text that only ever sits on one fill. */
const ON_FILL: [text: string, background: string][] = [
  ['primary-ink', 'primary'],
  ['primary-ink', 'primary-hover'],
  ['accent-ink', 'accent'],
  ['header-ink', 'header'],
  ['nav-ink', 'nav'],
  ['nav-ink', 'nav-raised'],
  ['nav-muted', 'nav'],
  ['nav-muted', 'nav-raised'],
];

const AA = 4.5;

function pairs(theme: Record<string, string>) {
  const all: [string, string][] = [
    ...TEXT.flatMap((text) => BACKGROUNDS.map((bg): [string, string] => [text, bg])),
    ...ON_FILL,
  ];
  return all.map(([text, background]) => {
    expect(theme[text], text).toBeDefined();
    expect(theme[background], background).toBeDefined();
    return { text, background, ratio: contrastRatio(theme[text]!, theme[background]!) };
  });
}

describe('contrastRatio', () => {
  it('matches the reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#1b6ae0', '#e6effc')).toBeCloseTo(4.33, 2);
  });
});

describe('colour tokens', () => {
  it.each([
    ['light', light],
    ['dark', dark],
    ['dark from the device setting', system],
  ])('give every text colour 4.5:1 on every background it can sit on: %s', (_name, theme) => {
    const low = pairs(theme)
      .filter((pair) => pair.ratio < AA)
      .map((pair) => `${pair.text} on ${pair.background}: ${pair.ratio.toFixed(2)}`);
    expect(low).toEqual([]);
  });

  it('keeps the two dark themes the same', () => {
    for (const name of [...TEXT, ...BACKGROUNDS, ...ON_FILL.flat()]) {
      expect(system[name], name).toBe(dark[name]);
    }
  });

  it('paints brand-coloured text with the text tokens, not the fills', () => {
    expect(css).toContain('--text-color-primary: var(--primary-text);');
    expect(css).toContain('--text-color-danger: var(--danger-text);');
    expect(css).toContain('--text-color-success: var(--success-text);');
  });
});
