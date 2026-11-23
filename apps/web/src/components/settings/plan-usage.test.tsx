// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FREE_PLAN_LIMITS, UNLIMITED_LIMITS } from '@/lib/plans';
import { settingsTabs } from '@/lib/settings-tabs';
import { PlanUsage, type UsageMeter } from './plan-usage';

const meters: UsageMeter[] = [
  {
    key: 'envelopesPerMonth',
    label: 'Envelopes sent this month',
    used: 10,
    max: 10,
    usedText: '10',
    maxText: '10',
    resetsAt: '1 December 2026 (UTC)',
  },
  {
    key: 'members',
    label: 'Members and open invitations',
    used: 1,
    max: 3,
    usedText: '1',
    maxText: '3',
    resetsAt: null,
  },
  {
    key: 'storageBytes',
    label: 'Stored documents',
    used: 170 * 1024 * 1024,
    max: 200 * 1024 * 1024,
    usedText: '170 MB',
    maxText: '200 MB',
    resetsAt: null,
  },
];

describe('PlanUsage', () => {
  it('shows the plan, every meter, the reset date and the way to pay', () => {
    render(
      <PlanUsage
        plan="free"
        limits={FREE_PLAN_LIMITS}
        meters={meters}
        billing={<button type="button">Upgrade to Cloud</button>}
      />,
    );
    expect(screen.getByTestId('plan-name')).toHaveTextContent('Free');
    const sends = screen.getByTestId('meter-envelopesPerMonth');
    expect(within(sends).getByRole('meter')).toHaveAttribute('aria-valuetext', '10 of 10');
    expect(within(sends).getByText('Limit reached')).toBeInTheDocument();
    expect(within(sends).getByText('Starts again on 1 December 2026 (UTC)')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('meter-storageBytes')).getByText('Nearly full'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('meter-members')).queryByText(/full|reached/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Upgrade to Cloud' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('hello@codevibe.in');
    expect(screen.getByText(`Up to ${FREE_PLAN_LIMITS.bulkRows}`)).toBeInTheDocument();
    expect(screen.getByText('Up to 10 MB')).toBeInTheDocument();
    expect(screen.getByText('Always shown')).toBeInTheDocument();
  });

  it('shows no bars and no upgrade for an unlimited workspace', () => {
    render(
      <PlanUsage
        plan="unlimited"
        limits={UNLIMITED_LIMITS}
        meters={meters.map((m) => ({ ...m, max: null, maxText: null }))}
      />,
    );
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upgrade to Cloud' })).toBeNull();
    expect(screen.getAllByText('(no limit)')).toHaveLength(3);
  });
});

describe('settingsTabs', () => {
  it('adds Plan and usage only on the hosted cloud', () => {
    const labels = (plans: boolean) =>
      settingsTabs('acme', 'viewer', { plans }).map((t) => t.label);
    expect(labels(false)).toEqual(['Personal']);
    expect(labels(true)).toEqual(['Plan and usage', 'Personal']);
  });
});
