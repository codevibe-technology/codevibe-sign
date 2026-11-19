import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/w/acme/settings')).toBe('/w/acme/settings');
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
      expect(safeNext(value), value).toBe('/');
    }
    expect(safeNext(undefined)).toBe('/');
  });
});
