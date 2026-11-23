import { describe, expect, it } from 'vitest';
import { metadataBase } from './metadata-base';

describe('metadataBase', () => {
  it('uses the public URL of the app', () => {
    expect(metadataBase('https://sign.codevibe.in')?.href).toBe('https://sign.codevibe.in/');
  });

  it('gives nothing for a missing or malformed value', () => {
    expect(metadataBase(undefined)).toBeUndefined();
    expect(metadataBase('')).toBeUndefined();
    expect(metadataBase('sign.codevibe.in')).toBeUndefined();
    expect(metadataBase('ftp://sign.codevibe.in')).toBeUndefined();
  });
});
