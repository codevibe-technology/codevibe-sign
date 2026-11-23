// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planFeatures } from '@/lib/plans';
import type { PricingView } from '@/server/billing/pricing';
import type { PlanPrices, SubscriptionView } from '@/server/billing/subscriptions';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  start: vi.fn(),
  addSeats: vi.fn(),
  cancel: vi.fn(),
  renewalSeats: vi.fn(),
  confirm: vi.fn(),
  checkout: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error, message: vi.fn(), custom: vi.fn() },
}));
vi.mock('@/server/actions/subscriptions', () => ({
  startSubscriptionAction: mocks.start,
  addSeatsAction: mocks.addSeats,
  scheduleCancelAction: mocks.cancel,
  setRenewalSeatsAction: mocks.renewalSeats,
}));
vi.mock('@/server/actions/billing', () => ({ confirmPaymentAction: mocks.confirm }));
vi.mock('./razorpay-checkout', () => ({ openCheckout: mocks.checkout }));

const { PlanBilling } = await import('./plan-billing');
const { PlanComparison } = await import('./plan-comparison');
const { UpgradePrompt } = await import('./upgrade-prompt');

const PRICES: PlanPrices = {
  monthPaise: 99_900,
  yearPaise: 999_000,
  seatMonthPaise: 9_900,
  seatYearPaise: 99_000,
  includedMembers: 25,
  annualMonths: 10,
  gstPercent: 18,
  graceDays: 7,
};

const NONE: SubscriptionView = {
  state: 'none',
  term: null,
  seats: 0,
  renewalSeats: 0,
  periodEnd: null,
  graceEndsAt: null,
  cancelAtPeriodEnd: false,
  canRenew: false,
  renewFrom: null,
};
const ACTIVE: SubscriptionView = {
  ...NONE,
  state: 'active',
  term: 'month',
  periodEnd: '23 Dec 2026',
  renewFrom: '16 Dec 2026',
};

const SESSION = {
  orderId: 'order_1',
  amountPaise: 117_882,
  currency: 'INR',
  keyId: 'rzp_test_x',
  name: 'Codevibe',
  description: 'Cloud',
  prefill: { name: 'Acme', email: 'a@example.com' },
  testMode: true,
};

function show(overrides: Partial<Parameters<typeof PlanBilling>[0]> = {}) {
  return render(
    <PlanBilling
      workspaceId="ws_1"
      slug="acme"
      subscription={NONE}
      prices={PRICES}
      paymentsOpen
      testMode={false}
      hasBillingDetails
      canManage
      {...overrides}
    />,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('PlanBilling', () => {
  it('prices a first term with extra members and pays for it', async () => {
    const user = userEvent.setup();
    mocks.start.mockResolvedValue({ ok: true, data: SESSION });
    mocks.checkout.mockResolvedValue({ orderId: 'order_1', paymentId: 'pay_1', signature: 's' });
    mocks.confirm.mockResolvedValue({ ok: true, data: { status: 'paid' } });
    show();
    expect(screen.getByTestId('plan-total')).toHaveTextContent('₹999');
    await user.click(screen.getByRole('button', { name: 'More: Extra members' }));
    await user.click(screen.getByRole('button', { name: 'More: Extra members' }));
    expect(screen.getByTestId('plan-total')).toHaveTextContent('₹1,197');
    await user.click(screen.getByRole('radio', { name: /One year/ }));
    expect(screen.getByText('2 months free')).toBeInTheDocument();
    expect(screen.getByTestId('plan-total')).toHaveTextContent('₹11,970');
    expect(screen.getByText(/plus 18% GST/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.start).toHaveBeenCalledWith({ workspaceId: 'ws_1', term: 'year', seats: 2 });
    expect(mocks.checkout).toHaveBeenCalledWith(SESSION);
    expect(mocks.confirm).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      orderId: 'order_1',
      paymentId: 'pay_1',
      signature: 's',
    });
    expect(mocks.success).toHaveBeenCalledWith('This workspace is now on Cloud.');
  });

  it('does nothing more when the payment window is closed, and shows a refusal', async () => {
    const user = userEvent.setup();
    mocks.start.mockResolvedValue({ ok: true, data: SESSION });
    mocks.checkout.mockResolvedValue(null);
    show();
    await user.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }));
    await waitFor(() => expect(mocks.checkout).toHaveBeenCalled());
    expect(mocks.confirm).not.toHaveBeenCalled();

    mocks.start.mockResolvedValue({ ok: false, code: 'CONFLICT', error: 'Not now.' });
    await user.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Not now.'));
  });

  it('says payments are coming while they are closed', () => {
    show({ paymentsOpen: false });
    expect(screen.getByTestId('payments-closed')).toHaveTextContent('Coming soon');
    expect(screen.queryByRole('button', { name: 'Upgrade to Cloud' })).toBeNull();
  });

  it('asks for billing details first and leaves members without a button', () => {
    const { unmount } = show({ hasBillingDetails: false });
    expect(screen.getByRole('link', { name: 'Add billing details' })).toHaveAttribute(
      'href',
      '/dashboard/acme/settings/billing',
    );
    expect(screen.queryByRole('button', { name: 'Upgrade to Cloud' })).toBeNull();
    unmount();
    show({ canManage: false });
    expect(screen.getByText(/An admin or owner/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Cloud' })).toBeNull();
  });

  it('marks test mode', () => {
    show({ testMode: true });
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(screen.getByText(/No money moves/)).toBeInTheDocument();
  });

  it('shows a paid term, when the next can be paid, and adds members', async () => {
    const user = userEvent.setup();
    mocks.addSeats.mockResolvedValue({ ok: true, data: SESSION });
    mocks.checkout.mockResolvedValue({ orderId: 'order_1', paymentId: 'pay_1', signature: 's' });
    mocks.confirm.mockResolvedValue({ ok: true, data: { status: 'paid' } });
    show({ subscription: ACTIVE });
    expect(screen.getByText(/Paid up to/)).toHaveTextContent(
      'Paid up to 23 Dec 2026. The next term can be paid from 16 Dec 2026.',
    );
    expect(screen.queryByRole('button', { name: /Pay for the next term/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add members' }));
    const dialog = screen.getByRole('dialog', { name: 'Add members' });
    expect(dialog).toHaveTextContent('You pay for the days left in this term, up to 23 Dec 2026');
    await user.click(within(dialog).getByRole('button', { name: 'More: Members to add' }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.addSeats).toHaveBeenCalledWith({ workspaceId: 'ws_1', add: 2 });
  });

  it('offers the next term in its last days', () => {
    show({
      subscription: { ...ACTIVE, canRenew: true, renewFrom: null, renewalSeats: 3, seats: 3 },
    });
    expect(screen.getByRole('button', { name: 'Pay for the next term' })).toBeInTheDocument();
    expect(screen.getByTestId('plan-total')).toHaveTextContent('₹1,296');
  });

  it('cancels at the end of the term after saying what happens, and can undo it', async () => {
    const user = userEvent.setup();
    mocks.cancel.mockResolvedValue({ ok: true, data: { cancelAtPeriodEnd: true } });
    const { unmount } = show({ subscription: ACTIVE });
    await user.click(screen.getByRole('button', { name: 'Cancel plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel the Cloud plan?' });
    expect(dialog).toHaveTextContent('Nothing is deleted');
    expect(dialog).toHaveTextContent('not refunded');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel at the end of the term' }));
    await waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith({ workspaceId: 'ws_1', cancel: true }),
    );
    unmount();

    show({ subscription: { ...ACTIVE, cancelAtPeriodEnd: true } });
    expect(screen.getByText(/It will not be renewed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add members' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Keep Cloud' }));
    await waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith({ workspaceId: 'ws_1', cancel: false }),
    );
  });

  it('warns in the grace days and lets the term be paid', () => {
    show({
      subscription: {
        ...ACTIVE,
        state: 'grace',
        canRenew: true,
        renewFrom: null,
        graceEndsAt: '30 Dec 2026',
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The Cloud term ended on 23 Dec 2026. Everything keeps working until 30 Dec 2026.',
    );
    expect(screen.getByRole('button', { name: 'Pay for the next term' })).toBeInTheDocument();
  });

  it('has nothing to pay for a plan our team set', () => {
    show({ subscription: { ...NONE, state: 'managed' } });
    expect(screen.getByTestId('plan-billing')).toHaveTextContent('set up by our team');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

const PRICING: PricingView = {
  cloudMonth: '₹999',
  cloudYear: '₹9,990',
  yearSaving: '2 months free',
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

describe('PlanComparison', () => {
  it('lists every plan row with the price of an eSign and nothing about how it is made up', () => {
    const features = planFeatures({ mode: 'hosted', freeOverrides: {} });
    render(<PlanComparison features={features} pricing={PRICING} current="free" />);
    const table = screen.getByTestId('plan-comparison');
    expect(table).toHaveTextContent('Cloud is ₹999 a month for a workspace, or ₹9,990 a year');
    for (const row of features) expect(within(table).getByText(row.label)).toBeInTheDocument();
    expect(table).toHaveTextContent('₹35 per eSign, prepaid');
    expect(table).toHaveTextContent('Price coming soon, prepaid');
    expect(table.textContent).not.toMatch(/markup|at cost|lower price|provider cost/i);
    expect(within(table).getByText('Yours')).toBeInTheDocument();
  });
});

describe('UpgradePrompt', () => {
  const limit = { limit: 'activeTemplates', used: 2, max: 2, plan: 'free' as const };

  it('names the limit, the usage and the plan page of the workspace', () => {
    render(
      <UpgradePrompt
        message="This workspace has 2 of 2 active templates."
        limit={limit}
        slug="acme"
      />,
    );
    const prompt = screen.getByRole('alert');
    expect(prompt).toHaveTextContent('This workspace has 2 of 2 active templates.');
    expect(prompt).toHaveTextContent('2 of 2 used on the Free plan.');
    expect(within(prompt).getByRole('link', { name: 'See Cloud plan' })).toHaveAttribute(
      'href',
      '/dashboard/acme/settings/plan',
    );
  });

  it('points at pricing outside a workspace and at the plan page on Cloud', () => {
    const { unmount } = render(<UpgradePrompt message="No more." />);
    expect(screen.getByRole('link', { name: 'See Cloud plan' })).toHaveAttribute(
      'href',
      '/#pricing',
    );
    unmount();
    render(
      <UpgradePrompt
        message="25 of 25 members."
        limit={{ ...limit, limit: 'members', plan: 'cloud', used: 25, max: 25 }}
        slug="acme"
      />,
    );
    expect(screen.getByRole('link', { name: 'Plan and usage' })).toBeInTheDocument();
  });
});
