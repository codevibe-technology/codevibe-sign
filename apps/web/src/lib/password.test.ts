import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem, passwordStrength } from './password';

const COMMON = /first anyone would guess/;

describe('passwordProblem', () => {
  it('accepts long passwords without asking for symbols or capitals', () => {
    for (const password of [
      'correct horse battery staple',
      'mango-river-lantern',
      'tQ7#vL2pZx9w',
      'पासवर्ड-नदी-आम-दीपक',
      'my dog ate 3 samosas',
    ]) {
      expect(passwordProblem(password), password).toBeNull();
    }
  });

  it('asks for the minimum length and stops at the maximum', () => {
    expect(passwordProblem('k9$mango-'.slice(0, PASSWORD_MIN - 1))).toMatch(/at least 10/);
    expect(passwordProblem('')).toMatch(/at least 10/);
    expect(passwordProblem('ab '.repeat(50))).toMatch(/at most 128/);
    expect(
      passwordProblem('k9$' + 'mango river lantern '.repeat(6).slice(0, PASSWORD_MAX - 3)),
    ).toBeNull();
  });

  it('refuses the passwords everyone tries first, however they are dressed up', () => {
    for (const password of [
      'password123',
      'Password@123',
      'P@ssw0rd123!',
      'passwordpassword',
      'Welcome@2026',
      'welcome12345',
      'Qwerty12345',
      'qwertyuiop',
      'QWERTYUIOP[]',
      'letmein12345',
      'iloveyou123',
      'admin@12345',
      'Administrator1',
      'India@12345',
      'codevibe123',
      'changeme2026',
      'test1234567',
    ]) {
      expect(passwordProblem(password), password).toMatch(COMMON);
    }
  });

  it('refuses runs and repeats', () => {
    for (const password of [
      '1234567890',
      '0987654321',
      '12345678901',
      'abcdefghij',
      'zyxwvutsrq',
      'asdfghjklasdf',
      '1q2w3e4r5t',
      '1qaz2wsx3edc',
      'aaaaaaaaaa',
      '1212121212',
      'abcabcabcabc',
      'xyzwxyzwxyzw',
    ]) {
      expect(passwordProblem(password), password).toMatch(COMMON);
    }
  });

  it('refuses passwords built from the account’s own email or name', () => {
    const account = { email: 'Asha.Rao@Example.com', name: 'Asha Rao' };
    expect(passwordProblem('asha.rao-2026!', account)).toMatch(/email address or name/);
    expect(passwordProblem('asha.rao@example.com', account)).toMatch(/email address or name/);
    expect(passwordProblem('xx-Asha Rao-xx', account)).toMatch(/email address or name/);
    expect(passwordProblem('xxAshaRaoxx1', account)).toMatch(/email address or name/);
    expect(passwordProblem('mango-river-lantern', account)).toBeNull();
  });

  it('ignores account parts too short to mean anything', () => {
    expect(passwordProblem('mango-river-li-lantern', { email: 'li@x.io', name: 'Li' })).toBeNull();
  });
});

describe('passwordStrength', () => {
  it('says nothing before anything is typed', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
  });

  it('calls everything the rules refuse too weak, however decorated', () => {
    for (const password of ['short', 'P@ssw0rd123!', 'qwertyuiop', 'asha.rao.2026']) {
      expect(
        passwordStrength(password, { email: 'asha.rao@example.com', name: 'Asha Rao' }),
      ).toEqual({ score: 1, label: 'Too weak' });
    }
  });

  it('grows with length first, then with a mix of characters', () => {
    expect(passwordStrength('mangoriver').label).toBe('Fair');
    expect(passwordStrength('mango river lantern').label).toBe('Good');
    expect(passwordStrength('Mango-river-7').label).toBe('Good');
    expect(passwordStrength('seven quiet copper kettles').label).toBe('Strong');
    expect(passwordStrength('Mango-River-Lamp-7').label).toBe('Strong');
  });
});
