import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, headerRules } from './security-headers';

const directives = (policy: string) =>
  new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values] as const;
    }),
  );

describe('contentSecurityPolicy', () => {
  it('loads code only from the app itself and refuses plugins, framing and foreign forms', () => {
    const policy = directives(contentSecurityPolicy({ development: false }));
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    const foreign = policy.get('script-src')!.filter((source) => /^https?:|^\*/.test(source));
    expect(foreign).toEqual(['https://checkout.razorpay.com']);
  });

  it('lets Razorpay Checkout open its payment frame and nothing else', () => {
    const policy = directives(contentSecurityPolicy({ development: false }));
    expect(policy.get('frame-src')).toEqual([
      "'self'",
      'https://api.razorpay.com',
      'https://checkout.razorpay.com',
    ]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    expect(policy.get('img-src')!.some((source) => source.includes('razorpay'))).toBe(false);
  });

  it('takes fonts and styles from the app itself, with no font service', () => {
    const policy = directives(contentSecurityPolicy({ development: false }));
    expect(policy.get('font-src')).toEqual(["'self'", 'data:']);
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('allows eval only in development, where the dev server needs it', () => {
    expect(contentSecurityPolicy({ development: false })).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ development: true })).toContain("'unsafe-eval'");
  });

  it('lets the PDF viewer run its worker and show pages', () => {
    const policy = directives(contentSecurityPolicy({ development: false }));
    expect(policy.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(policy.get('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']));
  });
});

describe('headerRules', () => {
  const rules = headerRules({ development: false });
  const valueFor = (source: string, key: string) =>
    rules.find((rule) => rule.source === source)?.headers.find((h) => h.key === key)?.value;

  it('sends the policy and the fixed headers on every path', () => {
    expect(valueFor('/:path*', 'Content-Security-Policy')).toContain("default-src 'self'");
    expect(valueFor('/:path*', 'X-Content-Type-Options')).toBe('nosniff');
    expect(valueFor('/:path*', 'X-Frame-Options')).toBe('DENY');
  });

  it('sends no referrer at all from the signing link, page and API', () => {
    for (const source of ['/sign', '/api/sign/:path*', '/api/v1/sign/:path*']) {
      expect(valueFor(source, 'Referrer-Policy')).toBe('no-referrer');
    }
    const order = rules.map((rule) => rule.source);
    expect(order.indexOf('/:path*')).toBeLessThan(order.indexOf('/sign'));
  });

  it('sends no referrer from a password reset link or an invitation', () => {
    for (const source of ['/reset-password', '/api/auth/reset-password/:path*', '/invite/:path*']) {
      expect(valueFor(source, 'Referrer-Policy')).toBe('no-referrer');
    }
  });

  it('keeps public record pages out of search engines and out of referrers', () => {
    expect(valueFor('/r/:path*', 'Referrer-Policy')).toBe('no-referrer');
    expect(valueFor('/r/:path*', 'X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
    const order = rules.map((rule) => rule.source);
    expect(order.indexOf('/:path*')).toBeLessThan(order.indexOf('/r/:path*'));
  });
});
