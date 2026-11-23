// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
