import { describe, expect, it } from 'vitest';
import {
  addMonths,
  billedMonths,
  daysBetween,
  formatPeriod,
  proratedPrice,
  reminderStage,
  termEnd,
  termPrice,
} from './terms';

const ist = (text: string) => new Date(`${text}+05:30`);

describe('addMonths', () => {
  it('keeps the day and the time of day in India', () => {
    expect(addMonths(ist('2026-11-23T15:30:00'), 1)).toEqual(ist('2026-12-23T15:30:00'));
    expect(addMonths(ist('2026-11-23T15:30:00'), 12)).toEqual(ist('2027-11-23T15:30:00'));
  });

  it('ends on the last day of a shorter month', () => {
    expect(addMonths(ist('2027-01-31T10:00:00'), 1)).toEqual(ist('2027-02-28T10:00:00'));
    expect(addMonths(ist('2028-01-31T10:00:00'), 1)).toEqual(ist('2028-02-29T10:00:00'));
    expect(addMonths(ist('2026-10-31T10:00:00'), 1)).toEqual(ist('2026-11-30T10:00:00'));
  });

  it('moves a leap day to 28 February a year later', () => {
    expect(addMonths(ist('2028-02-29T09:00:00'), 12)).toEqual(ist('2029-02-28T09:00:00'));
  });

  it('uses the India date, not the UTC one', () => {
    // 00:30 on 1 December in India is still 30 November in UTC.
    expect(addMonths(ist('2026-12-01T00:30:00'), 1)).toEqual(ist('2027-01-01T00:30:00'));
    expect(addMonths(ist('2026-12-31T23:45:00'), 1)).toEqual(ist('2027-01-31T23:45:00'));
  });
});

describe('term prices', () => {
  it('charges ten months for a year', () => {
    expect(billedMonths('month', 10)).toBe(1);
    expect(billedMonths('year', 10)).toBe(10);
    expect(termPrice(99_900, 'year', 10)).toBe(999_000);
    expect(termPrice(9_900, 'month', 10)).toBe(9_900);
  });

  it('ends a yearly term twelve calendar months on', () => {
    expect(termEnd(ist('2026-11-23T12:00:00'), 'year')).toEqual(ist('2027-11-23T12:00:00'));
  });
});

describe('proratedPrice', () => {
  const period = { start: ist('2026-11-01T00:00:00'), end: ist('2026-12-01T00:00:00') };

  it('charges the whole price on the first day and nothing after the end', () => {
    expect(proratedPrice(9_900, period, period.start)).toBe(9_900);
    expect(proratedPrice(9_900, period, period.end)).toBe(0);
    expect(proratedPrice(9_900, period, ist('2026-12-05T00:00:00'))).toBe(0);
  });

  it('charges for every started day that is left', () => {
    // 15 of 30 days left.
    expect(proratedPrice(9_900, period, ist('2026-11-16T00:00:00'))).toBe(4_950);
    // A day already started counts: 14 full days and a part.
    expect(proratedPrice(9_900, period, ist('2026-11-16T18:00:00'))).toBe(4_950);
    expect(proratedPrice(9_900, period, ist('2026-11-30T23:00:00'))).toBe(330);
  });

  it('rounds half a paisa up', () => {
    // 1 of 30 days of 15 paise is half a paisa.
    expect(proratedPrice(15, period, ist('2026-11-30T00:00:00'))).toBe(1);
    // 1 of 30 days of 14 paise is under half.
    expect(proratedPrice(14, period, ist('2026-11-30T00:00:00'))).toBe(0);
  });

  it('never charges more than the full price', () => {
    expect(proratedPrice(9_900, period, ist('2026-10-01T00:00:00'))).toBe(9_900);
  });
});

describe('dates and reminders', () => {
  it('counts started days', () => {
    expect(daysBetween(ist('2026-11-01T00:00:00'), ist('2026-11-01T00:00:01'))).toBe(1);
    expect(daysBetween(ist('2026-11-02T00:00:00'), ist('2026-11-01T00:00:00'))).toBe(0);
  });

  it('names the first and the last day a term covers', () => {
    expect(formatPeriod(ist('2026-11-23T15:00:00'), ist('2026-12-23T15:00:00'))).toBe(
      '23 Nov 2026 to 22 Dec 2026',
    );
  });

  it('reminds at seven, three and one days', () => {
    expect([9, 8, 7, 5, 4, 3, 2, 1, 0].map(reminderStage)).toEqual([
      null,
      null,
      7,
      7,
      7,
      3,
      3,
      1,
      null,
    ]);
  });
});
