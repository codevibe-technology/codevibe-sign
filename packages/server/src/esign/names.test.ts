import { describe, expect, it } from 'vitest';
import { namesMatch } from './names';

describe('namesMatch', () => {
  it.each([
    ['Prakriti Iyer', 'PRAKRITI S IYER'],
    ['Prakriti S Iyer', 'Prakriti Iyer'],
    ['prakriti  iyer', 'Iyer Prakriti'],
    ['P. S. Iyer', 'Prakriti S Iyer'],
    ['José Pérez', 'JOSE PEREZ'],
    ['Ravi', 'RAVI KUMAR'],
  ])('takes %s and %s for the same person', (recipient, certificate) => {
    expect(namesMatch(recipient, certificate)).toBe(true);
  });

  it.each([
    ['Prakriti Iyer', 'Shubham Dhall'],
    ['Ravi Kumar', 'Ravi Sharma'],
    ['R Kumar', 'Suresh Kumar'],
    ['P S', 'Prakriti S Iyer'],
  ])('tells %s and %s apart', (recipient, certificate) => {
    expect(namesMatch(recipient, certificate)).toBe(false);
  });

  it('has nothing to compare when either name is empty', () => {
    expect(namesMatch('Ravi Kumar', '')).toBe(true);
    expect(namesMatch(' ', 'RAVI KUMAR')).toBe(true);
  });
});
