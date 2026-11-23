import { describe, expect, it } from 'vitest';
import {
  displayName,
  hasName,
  initialOf,
  parsePersonName,
  PERSON_NAME_MAX,
  personNameProblem,
} from './person-name';

const named = (raw: string) => {
  const result = parsePersonName(raw);
  return result.ok ? result.name : null;
};

describe('parsePersonName', () => {
  it('refuses nothing, spaces only and a single character', () => {
    expect(personNameProblem('')).toBe('Enter your name');
    expect(personNameProblem('   ')).toBe('Enter your name');
    expect(personNameProblem('\u00A0\u3000')).toBe('Enter your name');
    expect(personNameProblem(' A ')).toMatch(/at least 2 characters/);
  });

  it('accepts 2 and 80 characters and refuses 81', () => {
    expect(named('Li')).toBe('Li');
    expect(named('a'.repeat(PERSON_NAME_MAX))).toHaveLength(PERSON_NAME_MAX);
    expect(personNameProblem('a'.repeat(PERSON_NAME_MAX + 1))).toMatch(/80 characters or fewer/);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(named('𠮷'.repeat(PERSON_NAME_MAX))).not.toBeNull();
    expect(personNameProblem('𠮷')).toMatch(/at least 2/);
  });

  it('trims and collapses runs of spaces', () => {
    expect(named('  Ravi   Kumar  ')).toBe('Ravi Kumar');
    expect(named('Ravi\u00A0\u00A0Kumar')).toBe('Ravi Kumar');
  });

  it('accepts names in any script, with the marks names carry', () => {
    for (const name of [
      'José Álvarez',
      'शुभम कुमार',
      "O'Brien",
      'Anne-Marie',
      '王小明',
      'J. R. Rao',
    ]) {
      expect(named(name)).toBe(name);
    }
  });

  it('refuses control characters and text-direction marks', () => {
    for (const raw of [
      'Ravi\u0000Kumar',
      'Ravi\tKumar',
      'Ravi\nKumar',
      'Ravi\u007FK',
      'Ravi\u202EK',
    ]) {
      expect(personNameProblem(raw)).toMatch(/cannot be used/);
    }
  });

  it('refuses a name with no letter in it', () => {
    expect(personNameProblem('12345')).toBe('A name needs at least one letter');
    expect(personNameProblem('--')).toBe('A name needs at least one letter');
  });
});

describe('displayName', () => {
  it('uses the name, and the email only when there is none', () => {
    expect(displayName({ name: 'Asha Rao', email: 'asha@example.com' })).toBe('Asha Rao');
    expect(displayName({ name: '  ', email: 'asha@example.com' })).toBe('asha@example.com');
    expect(displayName({ name: null, email: 'asha@example.com' })).toBe('asha@example.com');
    expect(displayName({ email: 'asha@example.com' })).toBe('asha@example.com');
  });

  it('gives the avatar letter and says whether a name is saved', () => {
    expect(initialOf({ name: 'élodie', email: 'x@example.com' })).toBe('É');
    expect(initialOf({ name: '', email: 'ravi@example.com' })).toBe('R');
    expect(hasName({ name: ' ' })).toBe(false);
    expect(hasName({ name: 'Mia' })).toBe(true);
  });
});
