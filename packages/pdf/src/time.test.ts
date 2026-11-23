import { describe, expect, it } from 'vitest';
import { formatInZone, formatMoment, formatSigningDate, formatSigningTime } from './time';

describe('formatSigningDate', () => {
  it('gives the day in the zone, not the UTC day, on either side of midnight', () => {
    const lateInUtc = '2026-11-22T18:53:34.000Z';
    expect(formatSigningDate(lateInUtc)).toBe('22 Nov 2026');
    expect(formatSigningDate(lateInUtc, 'Asia/Kolkata')).toBe('23 Nov 2026');
    expect(formatSigningDate(lateInUtc, 'Pacific/Auckland')).toBe('23 Nov 2026');
    expect(formatSigningDate(lateInUtc, 'America/New_York')).toBe('22 Nov 2026');

    const earlyInUtc = '2026-11-23T03:10:00.000Z';
    expect(formatSigningDate(earlyInUtc, 'America/New_York')).toBe('22 Nov 2026');
    expect(formatSigningDate(earlyInUtc, 'Asia/Kolkata')).toBe('23 Nov 2026');
  });

  it('turns the day over at the zone’s own midnight, to the second', () => {
    expect(formatSigningDate('2026-11-22T18:29:59.000Z', 'Asia/Kolkata')).toBe('22 Nov 2026');
    expect(formatSigningDate('2026-11-22T18:30:00.000Z', 'Asia/Kolkata')).toBe('23 Nov 2026');
    expect(formatSigningDate('2026-12-31T10:59:59.000Z', 'Pacific/Auckland')).toBe('31 Dec 2026');
    expect(formatSigningDate('2026-12-31T11:00:00.000Z', 'Pacific/Auckland')).toBe('01 Jan 2027');
  });

  it('keeps the right day through a daylight saving change', () => {
    expect(formatSigningDate('2026-03-08T04:59:00.000Z', 'America/New_York')).toBe('07 Mar 2026');
    expect(formatSigningDate('2026-03-08T05:00:00.000Z', 'America/New_York')).toBe('08 Mar 2026');
    expect(formatSigningDate('2026-03-09T03:59:00.000Z', 'America/New_York')).toBe('08 Mar 2026');
    expect(formatSigningDate('2026-03-09T04:00:00.000Z', 'America/New_York')).toBe('09 Mar 2026');
  });

  it('leaves a plain date alone in any zone', () => {
    expect(formatSigningDate('2026-11-22', 'Pacific/Auckland')).toBe('22 Nov 2026');
  });
});

describe('formatSigningTime', () => {
  it('names the offset in force at that moment', () => {
    expect(formatSigningTime('2026-03-08T06:59:00.000Z', 'America/New_York')).toBe(
      '08 Mar 2026 01:59 GMT-5',
    );
    expect(formatSigningTime('2026-03-08T07:00:00.000Z', 'America/New_York')).toBe(
      '08 Mar 2026 03:00 GMT-4',
    );
    expect(formatSigningTime('2026-04-04T14:00:00.000Z', 'Pacific/Auckland')).toBe(
      '05 Apr 2026 02:00 GMT+12',
    );
    expect(formatSigningTime('2026-11-22T18:53:34.000Z')).toBe('22 Nov 2026 18:53 UTC');
  });
});

describe('formatMoment', () => {
  it('always gives UTC, and the zone next to it when one is set', () => {
    const at = '2026-11-22T18:53:34.000Z';
    expect(formatMoment(at)).toBe('2026-11-22 18:53:34 UTC');
    expect(formatMoment(at, 'UTC')).toBe('2026-11-22 18:53:34 UTC');
    expect(formatMoment(at, 'Asia/Kolkata')).toBe(
      '2026-11-22 18:53:34 UTC / 2026-11-23 00:23:34 GMT+5:30 (Asia/Kolkata)',
    );
    expect(formatMoment(at, 'America/New_York')).toBe(
      '2026-11-22 18:53:34 UTC / 2026-11-22 13:53:34 GMT-5 (America/New_York)',
    );
  });

  it('handles zones with unusual offsets', () => {
    const at = new Date('2026-11-22T18:53:34.000Z');
    expect(formatInZone(at, 'Asia/Kathmandu')).toBe(
      '2026-11-23 00:38:34 GMT+5:45 (Asia/Kathmandu)',
    );
    expect(formatInZone(at, 'Pacific/Chatham')).toBe(
      '2026-11-23 08:38:34 GMT+13:45 (Pacific/Chatham)',
    );
  });
});
