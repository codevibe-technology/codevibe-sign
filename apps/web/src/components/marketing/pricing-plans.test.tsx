// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { pricedFeatures } from '@/components/billing/plan-comparison';
import { planFeatures } from '@/lib/plans';
import type { PricingView } from '@/server/billing/pricing';
import { PricingPlans } from './pricing-plans';

const FEATURES = planFeatures({ mode: 'hosted', freeOverrides: {} });
const PRICING: PricingView = {
  cloudMonth: '₹999',
  cloudYear: '₹9,990',
  yearSaving: '2 months free',
  yearSavingAmount: '₹1,998',
  extraMember: '₹99',
  includedMembers: 25,
  esignFree: '₹35 per eSign',
  esignCloud: 'Price coming soon',
  installHelp: '₹1,999',
  gstPercent: 18,
  graceDays: 7,
  paymentsOpen: true,
  testMode: false,
  operatorEmail: null,
  hostingOffers: [],
};
const START = { href: '/sign-in', label: 'Start free' };

function renderPlans(pricing: PricingView = PRICING) {
  return render(
    <PricingPlans
      rows={pricedFeatures(FEATURES, pricing)}
      pricing={pricing}
      start={START}
      signedIn={false}
    />,
  );
}

const card = (name: string) => screen.getByRole('article', { name: new RegExp(`^${name}`) });

describe('PricingPlans', () => {
  it('shows three plans with Cloud recommended and only the essentials', () => {
    renderPlans();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(card('Cloud')).toHaveAccessibleName('Cloud, recommended');
    expect(within(card('Free')).getByText('₹35 per eSign')).toBeInTheDocument();
    expect(within(card('Cloud')).getByText('Price coming soon')).toBeInTheDocument();
    expect(within(card('Free')).getAllByRole('term')).toHaveLength(4);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches Cloud to the annual price with the saving worked out from the settings', async () => {
    renderPlans();
    const cloud = card('Cloud');
    expect(within(cloud).getByText('₹999')).toBeInTheDocument();
    expect(within(cloud).queryByText('Save ₹1,998 a year (2 months free)')).toBeNull();
    await userEvent.click(within(cloud).getByRole('button', { name: /Annual/ }));
    expect(within(cloud).getByRole('button', { name: /Annual/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(cloud).getByText('₹9,990')).toBeInTheDocument();
    expect(within(cloud).getByText('Save ₹1,998 a year (2 months free)')).toBeInTheDocument();
  });

  it('claims no saving when a year costs twelve months', async () => {
    renderPlans({ ...PRICING, cloudYear: '₹11,988', yearSaving: null, yearSavingAmount: null });
    await userEvent.click(screen.getByRole('button', { name: 'Annual' }));
    expect(screen.queryByText(/Save/)).toBeNull();
  });

  it('opens the full comparison on request', async () => {
    renderPlans();
    const toggle = screen.getByRole('button', { name: 'See everything included' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const table = screen.getByRole('table', { name: /Everything in Free, Cloud and Self-hosted/ });
    expect(within(table).getAllByRole('row')).toHaveLength(FEATURES.length + 2);
    expect(within(table).getByRole('rowheader', { name: 'Webhooks' })).toBeInTheDocument();
    expect(toggle).toHaveAccessibleName('Hide the full comparison');
  });

  it('makes the paid installation help plain on the self-hosted plan', () => {
    renderPlans();
    const self = card('Self-hosted');
    expect(
      within(self).getByText(
        'An experienced engineer installs it on your server within 4 working hours for a flat ₹1,999 + GST.',
      ),
    ).toBeInTheDocument();
    expect(within(self).getByRole('link', { name: 'Book installation help' })).toHaveAttribute(
      'href',
      '/install-help',
    );
  });

  it('asks for the hosting discount link by email when no offer is set', () => {
    renderPlans();
    expect(
      screen.getByText(
        'Need a server? Get VPS hosting from our partners with an extra 20% discount.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask us for the discount link' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:hello@codevibe\.in\?subject=/),
    );
    expect(screen.getByRole('link', { name: 'hello@codevibe.in' })).toBeInTheDocument();
  });

  it('lists the hosting offers when they are set', () => {
    renderPlans({
      ...PRICING,
      hostingOffers: [{ name: 'Example Cloud', url: 'https://example.com/vps', note: 'VPS plans' }],
    });
    expect(screen.getByRole('link', { name: /Example Cloud/ })).toHaveAttribute(
      'href',
      'https://example.com/vps',
    );
    expect(screen.queryByRole('link', { name: 'Ask us for the discount link' })).toBeNull();
  });
});
