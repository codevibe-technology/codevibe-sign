import { describe, expect, it } from 'vitest';
import { isTimeZone, searchTimeZones, timeZones, zoneLabel } from './preferences';
import { signingDay } from './signing';

const WINTER = new Date('2026-01-15T12:00:00.000Z');
const SUMMER = new Date('2026-07-15T12:00:00.000Z');

describe('timeZones', () => {
  const zones = timeZones();

  it('lists every zone under its current name, UTC first, with no doubles', () => {
    expect(zones[0]).toBe('UTC');
    expect(zones.length).toBeGreaterThan(300);
    expect(new Set(zones).size).toBe(zones.length);
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland', 'Europe/Kyiv']) {
      expect(zones, zone).toContain(zone);
    }
    expect(zones).not.toContain('Asia/Calcutta');
  });

  it('only lists zones the runtime can format in', () => {
    expect(zones.filter((zone) => !isTimeZone(zone))).toEqual([]);
  });
});

describe('isTimeZone', () => {
  it('accepts IANA names and refuses anything else', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Phobos')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone('A'.repeat(65))).toBe(false);
  });
});

describe('zoneLabel', () => {
  it('names the zone with the offset in force on that day', () => {
    expect(zoneLabel('Asia/Kolkata', WINTER)).toBe('Asia/Kolkata (GMT+5:30)');
    expect(zoneLabel('America/New_York', WINTER)).toBe('America/New York (GMT-5)');
    expect(zoneLabel('America/New_York', SUMMER)).toBe('America/New York (GMT-4)');
    expect(zoneLabel('Pacific/Auckland', WINTER)).toBe('Pacific/Auckland (GMT+13)');
    expect(zoneLabel('Pacific/Auckland', SUMMER)).toBe('Pacific/Auckland (GMT+12)');
  });

  it('falls back to the name for a zone it cannot place', () => {
    expect(zoneLabel('Mars/Phobos')).toBe('Mars/Phobos');
  });
});

describe('searchTimeZones', () => {
  const zones = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Asia/Kathmandu', 'Pacific/Auckland'];

  it('finds zones by city, region or offset, in any case', () => {
    expect(searchTimeZones(zones, 'kol', WINTER)).toEqual(['Asia/Kolkata']);
    expect(searchTimeZones(zones, 'new york', WINTER)).toEqual(['America/New_York']);
    expect(searchTimeZones(zones, 'New_York', WINTER)).toEqual(['America/New_York']);
    expect(searchTimeZones(zones, 'ASIA', WINTER)).toEqual(['Asia/Kolkata', 'Asia/Kathmandu']);
    expect(searchTimeZones(zones, '+5:30', WINTER)).toEqual(['Asia/Kolkata']);
    expect(searchTimeZones(zones, 'asia 5:45', WINTER)).toEqual(['Asia/Kathmandu']);
  });

  it('gives everything for an empty search and nothing for no match', () => {
    expect(searchTimeZones(zones, '  ')).toEqual(zones);
    expect(searchTimeZones(zones, 'atlantis')).toEqual([]);
  });
});

describe('signingDay', () => {
  it('is the day in the workspace zone, written as the document prints it', () => {
    const at = new Date('2026-11-04T18:53:34.000Z');
    expect(signingDay(at, 'UTC')).toBe('04 Nov 2026');
    expect(signingDay(at, 'Asia/Kolkata')).toBe('05 Nov 2026');
    expect(signingDay(at, 'America/New_York')).toBe('04 Nov 2026');
    expect(signingDay(at, 'Pacific/Auckland')).toBe('05 Nov 2026');
  });

  it('turns over at the zone’s midnight', () => {
    expect(signingDay(new Date('2026-11-22T18:29:59.000Z'), 'Asia/Kolkata')).toBe('22 Nov 2026');
    expect(signingDay(new Date('2026-11-22T18:30:00.000Z'), 'Asia/Kolkata')).toBe('23 Nov 2026');
  });
});
