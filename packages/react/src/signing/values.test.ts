import { describe, expect, it } from 'vitest';
import { fakePng, field, recipient } from '../test/fixtures';
import {
  fieldStatus,
  initialsOf,
  isoDate,
  prefillValues,
  sortFields,
  toFieldValues,
  validateFieldValues,
} from './values';

const sig = field('sig', 'signature', 'r1', { y: 600 });
const name = field('name', 'name', 'r1', { y: 500 });
const date = field('date', 'date_signed', 'r1', { y: 650 });
const agree = field('agree', 'checkbox', 'r1', { y: 100 }, { required: true });
const optIn = field('optin', 'checkbox', 'r1', { y: 120 }, { required: false });
const note = field('note', 'text', 'r1', { y: 200 }, { required: false });
const png = fakePng();

describe('validateFieldValues', () => {
  it('lists required fields that are empty', () => {
    const result = validateFieldValues([sig, name, agree, note], { name: '  ', agree: 'false' });
    expect(result).toEqual({ valid: false, missing: ['sig', 'name', 'agree'], invalid: [] });
  });

  it('passes when every required field has a value', () => {
    const result = validateFieldValues([sig, name, agree, note], {
      sig: png,
      name: 'Asha Rao',
      agree: 'true',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a signature that is not a PNG, as core would', () => {
    expect(
      validateFieldValues([sig], { sig: btoa('GIF89a not a png at all, long enough') }).invalid,
    ).toEqual(['sig']);
  });

  it('rejects malformed dates and checkbox values', () => {
    const result = validateFieldValues([date, optIn], { date: '19/11/2026', optin: 'yes' });
    expect(result.invalid).toEqual(['date', 'optin']);
  });

  it('rejects text over the length limit', () => {
    const long = field('long', 'text', 'r1', {}, { required: false });
    expect(validateFieldValues([long], { long: 'x'.repeat(1001) }).invalid).toEqual(['long']);
  });
});

describe('fieldStatus', () => {
  it('marks required empty fields invalid only once errors are shown', () => {
    expect(fieldStatus(sig, undefined, false)).toBe('empty');
    expect(fieldStatus(sig, undefined, true)).toBe('invalid');
    expect(fieldStatus(note, undefined, true)).toBe('empty');
    expect(fieldStatus(sig, png, true)).toBe('filled');
    expect(fieldStatus(sig, 'abc', false)).toBe('invalid');
    expect(fieldStatus(date, 'bad', false)).toBe('invalid');
  });
});

describe('toFieldValues', () => {
  it('returns values in reading order and leaves out empty optional fields', () => {
    const fields = sortFields([sig, name, agree, optIn, note]);
    const payload = toFieldValues(fields, {
      sig: png,
      name: ' Asha Rao ',
      agree: 'true',
      note: '',
    });
    expect(payload).toEqual([
      { fieldId: 'agree', value: 'true' },
      { fieldId: 'optin', value: 'false' },
      { fieldId: 'name', value: 'Asha Rao' },
      { fieldId: 'sig', value: png },
    ]);
  });
});

describe('sortFields', () => {
  it('orders by document, page, then position', () => {
    const a = field('a', 'text', 'r1', { y: 10 }, { documentId: 'second' });
    const b = field('b', 'text', 'r1', { y: 500 }, { documentId: 'first', page: 1 });
    const c = field('c', 'text', 'r1', { y: 500, x: 300 }, { documentId: 'first' });
    const d = field('d', 'text', 'r1', { y: 500, x: 20 }, { documentId: 'first' });
    expect(sortFields([a, b, c, d], ['first', 'second']).map((f) => f.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
  });
});

describe('prefillValues', () => {
  it('fills the date, the recipient name and unchecked boxes', () => {
    const values = prefillValues(
      [date, name, optIn, sig],
      recipient('r1', 'Asha Rao'),
      new Date(2026, 10, 9),
    );
    expect(values).toEqual({ date: '2026-11-09', name: 'Asha Rao', optin: 'false' });
  });
});

describe('helpers', () => {
  it('formats local dates and initials', () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(initialsOf('asha  devi rao kumar')).toBe('ADR');
    expect(initialsOf('')).toBe('');
  });
});
