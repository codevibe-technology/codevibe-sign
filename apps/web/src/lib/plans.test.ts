import { describe, expect, it } from 'vitest';
import {
  CLOUD_PLAN_LIMITS,
  FREE_PLAN_LIMITS,
  UNLIMITED_LIMITS,
  formatBytes,
  isPlan,
  limitsFor,
  parseLimitOverrides,
  periodKey,
  resetsAt,
  upgradeHint,
} from './plans';

const hosted = { mode: 'hosted' as const, freeOverrides: {} };
const selfHosted = { mode: 'self-hosted' as const, freeOverrides: {} };

describe('plan limits', () => {
  it('gives the free plan its published limits', () => {
    expect(FREE_PLAN_LIMITS).toEqual({
      envelopesPerMonth: 10,
      members: 3,
      activeTemplates: 5,
      webhooks: 1,
      bulkRows: 25,
      apiRequestsPerDay: 100,
      fileBytes: 10 * 1024 * 1024,
      envelopeBytes: 25 * 1024 * 1024,
      storageBytes: 200 * 1024 * 1024,
      ownedWorkspaces: 1,
      customDomain: false,
      badgeRequired: true,
    });
  });

  it('gives cloud generous limits, a custom domain and an optional badge', () => {
    expect(CLOUD_PLAN_LIMITS.envelopesPerMonth).toBe(500);
    expect(CLOUD_PLAN_LIMITS.activeTemplates).toBeNull();
    expect(CLOUD_PLAN_LIMITS.storageBytes).toBe(20 * 1024 ** 3);
    expect(CLOUD_PLAN_LIMITS.customDomain).toBe(true);
    expect(CLOUD_PLAN_LIMITS.badgeRequired).toBe(false);
  });

  it('applies the plan in hosted mode', () => {
    expect(limitsFor('free', hosted)).toEqual(FREE_PLAN_LIMITS);
    expect(limitsFor('cloud', hosted)).toBe(CLOUD_PLAN_LIMITS);
    expect(limitsFor('unlimited', hosted)).toBe(UNLIMITED_LIMITS);
  });

  it('has no limits at all when self-hosted, whatever the stored plan', () => {
    for (const plan of ['free', 'cloud', 'unlimited'] as const) {
      expect(limitsFor(plan, selfHosted)).toBe(UNLIMITED_LIMITS);
    }
    expect(Object.values(UNLIMITED_LIMITS).filter((v) => typeof v === 'number')).toEqual([]);
  });

  it('lets FREE_PLAN_LIMITS override the free plan only', () => {
    const settings = { mode: 'hosted' as const, freeOverrides: { envelopesPerMonth: 20 } };
    expect(limitsFor('free', settings).envelopesPerMonth).toBe(20);
    expect(limitsFor('free', settings).members).toBe(3);
    expect(limitsFor('cloud', settings).envelopesPerMonth).toBe(500);
  });

  it('recognises plan names', () => {
    expect(isPlan('free')).toBe(true);
    expect(isPlan('pro')).toBe(false);
    expect(isPlan(undefined)).toBe(false);
  });
});

describe('parseLimitOverrides', () => {
  it('reads nothing from an empty value', () => {
    expect(parseLimitOverrides(undefined)).toEqual({});
    expect(parseLimitOverrides('  ')).toEqual({});
  });

  it('reads numbers, null for no limit and switches', () => {
    expect(
      parseLimitOverrides('{"envelopesPerMonth":50,"members":null,"customDomain":true}'),
    ).toEqual({ envelopesPerMonth: 50, members: null, customDomain: true });
  });

  it('names the variable when the JSON is broken', () => {
    expect(() => parseLimitOverrides('{envelopes')).toThrow(/FREE_PLAN_LIMITS must be a JSON/);
  });

  it('names the key that is wrong or unknown', () => {
    expect(() => parseLimitOverrides('{"members":-1}')).toThrow(/FREE_PLAN_LIMITS: members/);
    expect(() => parseLimitOverrides('{"members":"three"}')).toThrow(/members/);
    expect(() => parseLimitOverrides('{"seats":3}')).toThrow(/seats/);
  });
});

describe('periods', () => {
  const now = new Date('2026-11-20T23:30:00Z');

  it('keys monthly, daily and total counts in UTC', () => {
    expect(periodKey('month', now)).toBe('2026-11');
    expect(periodKey('day', now)).toBe('2026-11-20');
    expect(periodKey('total', now)).toBe('total');
  });

  it('says when a count starts again', () => {
    expect(resetsAt('month', now)?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(resetsAt('day', now)?.toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(resetsAt('month', new Date('2026-12-31T12:00:00Z'))?.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(resetsAt('total', now)).toBeNull();
  });
});

describe('formatting', () => {
  it('writes sizes the way people read them', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
    expect(formatBytes(20 * 1024 ** 3)).toBe('20 GB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(12)).toBe('12 bytes');
  });

  it('points free workspaces at the upgrade and others at raising the limit', () => {
    expect(upgradeHint('free')).toBe('Upgrade to Cloud: write to hello@codevibe.in.');
    expect(upgradeHint('cloud')).toBe('To raise it, write to hello@codevibe.in.');
  });
});
