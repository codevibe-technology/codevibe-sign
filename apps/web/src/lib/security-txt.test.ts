import { describe, expect, it } from 'vitest';
import { securityTxt } from './security-txt';

describe('securityTxt', () => {
  const text = securityTxt({
    appUrl: 'https://sign.codevibe.in',
    now: new Date('2026-11-23T17:40:00.000Z'),
  });
  const fields = text
    .trim()
    .split('\n')
    .map((line) => line.split(': ') as [string, string]);

  it('names the contact, the policy, the language and its own address', () => {
    expect(fields).toContainEqual(['Contact', 'mailto:security@codevibe.in']);
    expect(fields).toContainEqual([
      'Policy',
      'https://github.com/codevibe-technology/codevibe-sign/blob/main/SECURITY.md',
    ]);
    expect(fields).toContainEqual(['Preferred-Languages', 'en']);
    expect(fields).toContainEqual([
      'Canonical',
      'https://sign.codevibe.in/.well-known/security.txt',
    ]);
  });

  it('expires once, less than a year ahead, at a whole day', () => {
    const expires = fields.filter(([name]) => name === 'Expires');
    expect(expires).toEqual([['Expires', '2027-11-18T00:00:00Z']]);
  });

  it('ends with a newline', () => {
    expect(text.endsWith('\n')).toBe(true);
  });
});
