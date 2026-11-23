import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLOUD_PLAN_LIMITS,
  FREE_PLAN_LIMITS,
  CLOUD_FAIR_USE,
  PLAN_TABLE_END,
  PLAN_TABLE_START,
  UNLIMITED_LIMITS,
  billingVisible,
  formatBytes,
  formatReset,
  isPlan,
  limitsFor,
  parseLimitOverrides,
  periodKey,
  planFeatures,
  planTableMarkdown,
  resetsAt,
  upgradeHint,
} from './plans';

const hosted = { mode: 'hosted' as const, freeOverrides: {} };
const selfHosted = { mode: 'self-hosted' as const, freeOverrides: {} };

describe('plan limits', () => {
  it('gives the free plan its published limits', () => {
    expect(FREE_PLAN_LIMITS).toEqual({
      envelopesPerMonth: 10,
      members: 2,
      activeTemplates: 2,
      webhooks: 0,
      bulkRows: 10,
      apiRequestsPerMonth: 100,
      apiRequestsPerDay: null,
      fileBytes: 10 * 1024 * 1024,
      envelopeBytes: 25 * 1024 * 1024,
      storageBytes: 200 * 1024 * 1024,
      ownedWorkspaces: 1,
      customDomain: false,
      badgeRequired: true,
      ownEsignAccount: false,
    });
  });

  it('gives cloud no plan numbers beyond members, and only fair-use caps', () => {
    expect(CLOUD_PLAN_LIMITS.envelopesPerMonth).toBeNull();
    expect(CLOUD_PLAN_LIMITS.activeTemplates).toBeNull();
    expect(CLOUD_PLAN_LIMITS.apiRequestsPerMonth).toBeNull();
    expect(CLOUD_PLAN_LIMITS.members).toBe(25);
    expect(CLOUD_PLAN_LIMITS.ownEsignAccount).toBe(true);
    const capped = Object.entries(CLOUD_PLAN_LIMITS)
      .filter(([key, value]) => typeof value === 'number' && key !== 'members')
      .map(([key]) => key)
      .sort();
    expect(capped).toEqual([...CLOUD_FAIR_USE].sort());
    expect(CLOUD_PLAN_LIMITS.storageBytes).toBe(20 * 1024 ** 3);
    expect(CLOUD_PLAN_LIMITS.customDomain).toBe(true);
    expect(CLOUD_PLAN_LIMITS.badgeRequired).toBe(false);
  });

  it('applies the plan in hosted mode', () => {
    expect(limitsFor('free', hosted)).toEqual(FREE_PLAN_LIMITS);
    expect(limitsFor('cloud', hosted)).toEqual(CLOUD_PLAN_LIMITS);
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
    expect(limitsFor('free', settings).members).toBe(2);
    expect(limitsFor('cloud', settings).envelopesPerMonth).toBeNull();
  });

  it('adds paid members to the ones cloud includes, and only on cloud', () => {
    expect(limitsFor('cloud', hosted, 3).members).toBe(28);
    expect(limitsFor('cloud', { ...hosted, cloudIncludedMembers: 10 }, 2).members).toBe(12);
    expect(limitsFor('cloud', hosted, -4).members).toBe(25);
    expect(limitsFor('free', hosted, 5).members).toBe(2);
    expect(limitsFor('cloud', selfHosted, 5).members).toBeNull();
  });

  it('shows billing on the hosted cloud only', () => {
    expect(billingVisible(hosted)).toBe(true);
    expect(billingVisible(selfHosted)).toBe(false);
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

  it('turns the India month over at midnight in India', () => {
    const before = new Date('2026-11-30T18:29:59Z');
    const after = new Date('2026-11-30T18:30:00Z');
    expect(periodKey('ist-month', before)).toBe('2026-11');
    expect(periodKey('ist-month', after)).toBe('2026-12');
    expect(resetsAt('ist-month', before)?.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(resetsAt('ist-month', after)?.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(formatReset('ist-month', new Date('2026-11-30T18:30:00Z'))).toBe(
      '1 December 2026 (IST)',
    );
    expect(formatReset('month', new Date('2026-12-01T00:00:00Z'))).toBe('1 December 2026 (UTC)');
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

  it('points free workspaces at the upgrade and others at their plan page', () => {
    expect(upgradeHint('free')).toBe('Upgrade to Cloud on the Plan and usage page.');
    expect(upgradeHint('cloud')).toBe('See what your plan includes on the Plan and usage page.');
  });
});

describe('the plan comparison', () => {
  const rows = planFeatures(hosted);
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it('is written from the limits', () => {
    expect(row('members').free).toBe('2 members across your workspaces');
    expect(row('members').cloud).toBe(
      '25 members included across your workspaces, more can be added',
    );
    expect(row('activeTemplates').free).toBe('2 templates across your workspaces');
    expect(row('bulkRows').free).toBe('Up to 10 rows in one send');
    expect(row('apiRequestsPerMonth').free).toBe('100 requests a month across your workspaces');
    expect(row('webhooks').free).toBe('Not included');
    expect(row('ownEsignAccount').free).toBe('Not included');
    expect(row('ownEsignAccount').cloud).toBe('Included');
    expect(row('envelopesPerMonth').selfHosted).toBe('Unlimited');
  });

  it('follows an operator override', () => {
    const custom = planFeatures({ mode: 'hosted', freeOverrides: { members: 4 } });
    expect(custom.find((r) => r.key === 'members')?.free).toBe('4 members across your workspaces');
  });

  it('describes the hosted plans even on a self-hosted install', () => {
    expect(planFeatures(selfHosted)).toEqual(rows);
  });

  it('never talks about what a provider charges', () => {
    const text = JSON.stringify(rows).toLowerCase();
    for (const word of ['cost', 'markup', 'leegality', 'margin']) expect(text).not.toContain(word);
  });

  it('renders one table row per feature between the docs markers', () => {
    const table = planTableMarkdown(hosted);
    expect(table.split('\n')).toHaveLength(rows.length + 2);
    expect(table).toContain(
      '| Members | 2 members across your workspaces | 25 members included across your workspaces, more can be added | Unlimited |',
    );
    expect(PLAN_TABLE_START).not.toBe(PLAN_TABLE_END);
  });
});

describe('the plan tables in the docs', () => {
  const root = join(import.meta.dirname, '..', '..', '..', '..');
  const pages = [join(root, 'README.md')];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) pages.push(path);
    }
  };
  walk(join(root, 'apps', 'site'));
  walk(join(root, 'docs'));

  it('carry exactly the table the limits give, wherever a page has one', () => {
    const table = planTableMarkdown(hosted);
    for (const page of pages.filter((path) => existsSync(path))) {
      const text = readFileSync(page, 'utf8');
      const start = text.indexOf(PLAN_TABLE_START);
      if (start === -1) continue;
      const end = text.indexOf(PLAN_TABLE_END, start);
      expect(end, `${page} closes its plan table`).toBeGreaterThan(start);
      const body = text.slice(start + PLAN_TABLE_START.length, end).trim();
      const cells = (value: string) =>
        value.split('\n').map((line) =>
          line
            .split('|')
            .map((cell) => cell.trim())
            .map((cell) => (/^-+$/.test(cell) ? '---' : cell)),
        );
      expect(cells(body), page).toEqual(cells(table));
    }
  });
});
