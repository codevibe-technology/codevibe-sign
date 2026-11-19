import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone } from './mask';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('shubh@example.com')).toBe('s****@example.com');
    expect(maskEmail('a@b.in')).toBe('a****@b.in');
  });

  it('masks values that are not addresses', () => {
    expect(maskEmail('shubh')).toBe('s****');
    expect(maskEmail('@example.com')).toBe('@****');
  });
});

describe('maskPhone', () => {
  it('keeps the country code and the last four digits', () => {
    expect(maskPhone('+91 98765 43210')).toBe('+91******3210');
    expect(maskPhone('9876543210')).toBe('******3210');
  });

  it('masks short numbers too', () => {
    expect(maskPhone('12345')).toBe('*2345');
    expect(maskPhone('123')).toBe('*23');
  });
});
