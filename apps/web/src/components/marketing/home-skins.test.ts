import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/contrast';

const globals = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
const skins = readFileSync(new URL('./home-skins.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const HEX = /--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g;

function tokensIn(body: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(HEX)) found[name!] = value!;
  return found;
}

/** The light tokens, which the skins start from and which paper always has. */
const light = (() => {
  const start = globals.indexOf(":root,\n[data-theme='light'],\n.home-skin,\n.home-skin .paper");
  expect(start).toBeGreaterThanOrEqual(0);
  return tokensIn(globals.slice(globals.indexOf('{', start) + 1, globals.indexOf('}', start)));
})();

/** Every rule of the skins that sets colour tokens, with its selector. */
const blocks = [...skins.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector!.trim(), tokens: tokensIn(body!) }))
  .filter((block) => Object.keys(block.tokens).length > 0);

const TEXT = ['ink', 'muted', 'primary-text', 'success-text'];
const AA = 4.5;

function lowPairs(tokens: Record<string, string>): string[] {
  const theme = { ...light, ...tokens };
  const backgrounds = [
    'canvas',
    'surface',
    'surface-2',
    ...Object.keys(theme).filter((name) => name.startsWith('tint-')),
  ];
  const pairs: [string, string][] = [
    ...TEXT.filter((text) => text !== 'success-text').flatMap((text) =>
      backgrounds.map((bg): [string, string] => [text, bg]),
    ),
    ['primary-ink', 'primary'],
    ['primary-ink', 'primary-hover'],
    ['success-text', 'success-soft'],
    ['success-text', 'surface'],
    ['success-text', 'surface-2'],
    ['ink', 'primary-soft'],
    ['primary-text', 'primary-soft'],
  ];
  return pairs
    .map(([text, bg]) => ({ text, bg, ratio: contrastRatio(theme[text]!, theme[bg]!) }))
    .filter((pair) => pair.ratio < AA)
    .map((pair) => `${pair.text} on ${pair.bg}: ${pair.ratio.toFixed(2)}`);
}

describe('home page colour options', () => {
  it('declare a band for each option', () => {
    for (const option of ['a', 'b', 'c']) {
      expect(blocks.some((block) => block.selector.includes(`.home-${option} `))).toBe(true);
    }
  });

  it('keep paper on the light tokens', () => {
    expect(lowPairs({})).toEqual([]);
  });

  it.each(blocks.map((block) => [block.selector.replace(/\s+/g, ' '), block.tokens] as const))(
    'give every text colour 4.5:1 on every background of %s',
    (_selector, tokens) => {
      expect(lowPairs(tokens)).toEqual([]);
    },
  );

  it('use only the brand blue, teal and navy as their strong colours', () => {
    const strong = [...skins.matchAll(/rgb\((\d+) (\d+) (\d+)/g)].map(([, r, g, b]) =>
      [r, g, b].join(' '),
    );
    const brand = new Set([
      '27 106 224',
      '45 212 191',
      '13 27 42',
      '207 227 255',
      '24 96 208',
      '0 0 0',
    ]);
    expect(strong.filter((colour) => !brand.has(colour))).toEqual([]);
  });
});
