// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FREE_PLAN_LIMITS, UNLIMITED_LIMITS } from '@/lib/plans';
import type { Role } from '@/lib/roles';
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
  it('breaks the usage of the account down by workspace and marks the one you are in', () => {
    render(
      <PlanUsage
        plan="free"
        limits={FREE_PLAN_LIMITS}
        meters={meters}
        currentWorkspaceId="ws_2"
        workspaces={[
          {
            id: 'ws_1',
            slug: 'acme-hr',
            name: 'Acme HR',
            members: 2,
            activeTemplates: 1,
            envelopes: 7,
            apiRequests: 40,
            storageText: '12 MB',
            esigns: 3,
          },
          {
            id: 'ws_2',
            slug: 'acme-legal',
            name: 'Acme Legal',
            members: 1,
            activeTemplates: 1,
            envelopes: 3,
            apiRequests: 0,
            storageText: '1 MB',
            esigns: 0,
          },
        ]}
      />,
    );
    const table = screen.getByTestId('workspace-breakdown');
    expect(within(table).getByText(/one person in the count above/)).toBeInTheDocument();
    const hr = within(screen.getByTestId('breakdown-acme-hr'));
    expect(hr.getByText('Acme HR')).toBeInTheDocument();
    expect(hr.getByText('40')).toBeInTheDocument();
    expect(within(screen.getByTestId('breakdown-acme-legal')).getByText('(this one)')).toBeTruthy();
    expect(screen.getByText(/Counted across every workspace on this account/)).toBeTruthy();
  });

  it('leaves the breakdown out when there is nothing to break down', () => {
    render(<PlanUsage plan="free" limits={FREE_PLAN_LIMITS} meters={meters} />);
    expect(screen.queryByTestId('workspace-breakdown')).toBeNull();
  });

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

  it('shows Billing to owners and billing admins but not to admins', () => {
    const labels = (role: Role) => settingsTabs('acme', role, { plans: true }).map((t) => t.label);
    expect(labels('owner')).toContain('Billing');
    expect(labels('billing')).toEqual(['Billing', 'Plan and usage', 'Personal']);
    expect(labels('admin')).not.toContain('Billing');
    expect(labels('admin')).toContain('Team');
    expect(settingsTabs('acme', 'billing', { plans: false }).map((t) => t.label)).toEqual([
      'Personal',
    ]);
  });
});
