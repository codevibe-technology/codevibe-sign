import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/dashboard/acme/settings')).toBe('/dashboard/acme/settings');
    expect(safeNext(['/invite/abc', '/x'])).toBe('/invite/abc');
  });

  it('refuses anything that could leave the site', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'w/acme',
      '',
    ]) {
      expect(safeNext(value), value).toBe('/dashboard');
    }
    expect(safeNext(undefined)).toBe('/dashboard');
  });

  it('never lands on the public home page', () => {
    expect(safeNext('/')).toBe('/dashboard');
    expect(safeNext(['/'])).toBe('/dashboard');
  });
});
