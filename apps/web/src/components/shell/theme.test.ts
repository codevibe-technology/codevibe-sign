// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_THEME } from '@/lib/preferences';
import { applyTheme } from './theme';

const motion = (reduced: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduced })),
  );

describe('applyTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'startViewTransition');
    document.documentElement.removeAttribute('data-theme');
  });

  it('switches at once where the browser cannot cross-fade', () => {
    motion(false);
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('cross-fades through a view transition where it can', () => {
    motion(false);
    const start = vi.fn((swap: () => void) => swap());
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
    applyTheme('light');
    expect(start).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('skips the cross-fade with reduced motion', () => {
    motion(true);
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
    applyTheme('dark');
    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('the theme before anyone picks one', () => {
  const web = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8');

  it('is light, set by the server on the first paint', () => {
    expect(DEFAULT_THEME).toBe('light');
    const layout = web('app/layout.tsx');
    expect(layout).toContain('isTheme(saved) ? saved : DEFAULT_THEME');
    expect(layout).toContain('data-theme={theme}');
    expect(layout).not.toMatch(/<script|matchMedia|localStorage/);
  });

  it('turns dark only for people who chose dark, or chose to follow their device', () => {
    const css = web('app/globals.css');
    const followsDevice = css.match(/@media \(prefers-color-scheme: dark\) \{\s*([^{]+)\{/g) ?? [];
    expect(followsDevice.length).toBeGreaterThan(0);
    for (const rule of followsDevice) expect(rule).toContain("[data-theme='system']");
  });
});
