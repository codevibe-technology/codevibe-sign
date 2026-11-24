// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingOverview } from '@/server/billing/overview';
import type { EsignOverview } from '@/server/esign/overview';

const actions = vi.hoisted(() => ({
  setEsignModeAction: vi.fn(),
  saveEsignCredentialsAction: vi.fn(),
  removeEsignCredentialsAction: vi.fn(),
  testEsignConnectionAction: vi.fn(),
  saveBillingDetailsAction: vi.fn(),
  createCreditsOrderAction: vi.fn(),
  confirmPaymentAction: vi.fn(),
}));
const checkout = vi.hoisted(() => ({ openCheckout: vi.fn() }));
vi.mock('@/server/actions/esign', () => actions);
vi.mock('@/server/actions/billing', () => actions);
vi.mock('@/components/billing/razorpay-checkout', () => checkout);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { EsignSettingsPanel } = await import('./esign-settings');
const { BillingPanel } = await import('./billing-panel');

const esign = (overrides: Partial<EsignOverview> = {}): EsignOverview => ({
  settings: {
    mode: 'platform',
    own: {
      configured: false,
      keyHint: null,
      environment: null,
      savedAt: null,
      testedAt: null,
      testOk: null,
      sealPosition: false,
    },
    version: 0,
  },
  blocked: null,
  owed: 0,
  platformConfigured: true,
  platformSealPosition: false,
  coordinates: 'points, bottom-left',
  creditsRequired: true,
  billingVisible: true,
  ownAllowed: false,
  credits: { available: 7, reserved: 1 },
  pricePaise: 3500,
  testMode: true,
  sandbox: true,
  usage: [],
  webhookUrl: 'https://sign.example.test/api/v1/esign/webhooks/leegality',
  redirectUrl: 'https://sign.example.test/sign?esign=return',
  ...overrides,
});

const connected = {
  mode: 'own' as const,
  own: {
    configured: true,
    keyHint: '9876',
    environment: 'production' as const,
    savedAt: '2026-11-23T10:00:00.000Z',
    testedAt: null,
    testOk: null,
    sealPosition: false,
  },
  version: 3,
};

const billing = (overrides: Partial<BillingOverview> = {}): BillingOverview => ({
  details: {
    legalName: 'Acme Traders Private Limited',
    gstin: null,
    addressLine1: '12 MG Road',
    addressLine2: null,
    city: 'Mumbai',
    pin: '400001',
    stateCode: '27',
    email: 'accounts@acme.example',
  },
  credits: { available: 3, reserved: 0 },
  offer: {
    unavailable: null,
    pricePaise: 3500,
    packs: [10, 50, 200],
    gstPercent: 18,
    testMode: true,
  },
  invoices: [],
  ...overrides,
});

const session = {
  orderId: 'order_1',
  amountPaise: 41_300,
  currency: 'INR' as const,
  keyId: 'rzp_test_x',
  name: 'Codevibe',
  description: 'Aadhaar eSign credits',
  prefill: { name: 'Acme', email: 'accounts@acme.example' },
  testMode: true,
};

beforeEach(() => {
  for (const mock of [...Object.values(actions), checkout.openCheckout]) mock.mockReset();
});

describe('EsignSettingsPanel', () => {
  it('shows credits and the final price, never how the price is made up', () => {
    const { container } = render(
      <EsignSettingsPanel workspaceId="ws_1" slug="acme" overview={esign()} />,
    );
    expect(screen.getByTestId('esign-credits').textContent).toBe('7');
    expect(screen.getByTestId('esign-price').textContent).toBe('₹35 per eSign');
    expect(screen.getByText('Test mode')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Buy credits' }).getAttribute('href')).toBe(
      '/dashboard/acme/settings/billing',
    );
    expect(container.textContent).not.toMatch(/markup|at cost|provider cost|\+ ₹10/i);
  });

  it('shows an admin who does not own the account everything, and lets them change nothing', () => {
    render(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign()}
        canManage={false}
        managedBy="Asha Rao"
      />,
    );
    expect(screen.getByTestId('managed-by')).toHaveTextContent('Managed by Asha Rao.');
    expect(document.querySelector('fieldset')).toBeDisabled();
    for (const button of document.querySelectorAll('fieldset button')) {
      expect(button).toBeDisabled();
    }
  });

  it('says price coming soon while none is published', () => {
    render(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign({
          pricePaise: null,
          blocked: { reason: 'price_not_set', message: 'Aadhaar eSign is coming soon.' },
        })}
      />,
    );
    expect(screen.getByTestId('esign-price').textContent).toBe('Price coming soon');
    expect(screen.getByTestId('esign-blocked').textContent).toMatch(/coming soon/);
  });

  it('marks the service as coming soon when it is not switched on', () => {
    render(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign({
          platformConfigured: false,
          blocked: { reason: 'not_configured', message: 'Aadhaar eSign is coming soon.' },
        })}
      />,
    );
    const card = screen.getByTestId('esign-mode-platform');
    expect(within(card).getByText('Coming soon')).toBeTruthy();
    expect(within(card).queryByRole('link', { name: 'Buy credits' })).toBeNull();
  });

  it('keeps your own account behind the Cloud plan on Free', () => {
    render(<EsignSettingsPanel workspaceId="ws_1" slug="acme" overview={esign()} />);
    const card = screen.getByTestId('esign-mode-own');
    expect(within(card).getByText(/Part of the Cloud plan/)).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Connect account' })).toBeNull();
    expect(
      within(card).getByRole('link', { name: 'See the Cloud plan' }).getAttribute('href'),
    ).toBe('/dashboard/acme/settings/plan');
    expect(screen.queryByText('Set up your Leegality workflow')).toBeNull();
  });

  it('takes the account details in a write-only form and points at the field to fix', async () => {
    const user = userEvent.setup();
    actions.saveEsignCredentialsAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'Leegality did not accept these details.',
      field: 'apiKey',
    });
    render(
      <EsignSettingsPanel workspaceId="ws_1" slug="acme" overview={esign({ ownAllowed: true })} />,
    );
    expect(screen.getByText('https://sign.example.test/sign?esign=return')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Connect account' }));
    const token = screen.getByLabelText('Auth Token');
    expect(token.getAttribute('type')).toBe('password');
    await user.type(token, 'secret-token-1');
    await user.type(screen.getByLabelText('Private Salt'), 'secret-salt-1');
    await user.type(screen.getByLabelText('Workflow ID'), 'wf_1');
    await user.click(screen.getByRole('button', { name: 'Check and save' }));
    const sent = actions.saveEsignCredentialsAction.mock.calls[0]![0] as FormData;
    expect(Object.fromEntries(sent)).toEqual({
      workspaceId: 'ws_1',
      environment: 'production',
      apiKey: 'secret-token-1',
      privateSalt: 'secret-salt-1',
      workflowId: 'wf_1',
      v4Workflow: '',
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/did not accept/);
  });

  it('takes an optional V4 workflow and says whether the seal position is on', async () => {
    const user = userEvent.setup();
    actions.saveEsignCredentialsAction.mockResolvedValue({ ok: true, data: connected });
    const { rerender } = render(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign({ ownAllowed: true, settings: connected })}
      />,
    );
    expect(screen.getByTestId('esign-own-seal-position').textContent).toMatch(
      /Aadhaar seal position: off/,
    );
    expect(screen.getByTestId('esign-v4-steps').textContent).toMatch(
      /Download API Payload.*coordinates: points, bottom-left/,
    );
    await user.click(screen.getByRole('button', { name: 'Replace details' }));
    await user.type(screen.getByLabelText('Auth Token'), 'secret-token-1');
    await user.type(screen.getByLabelText('Private Salt'), 'secret-salt-1');
    await user.type(screen.getByLabelText('Workflow ID'), 'wf_1');
    await user.type(
      screen.getByLabelText('V4 workflow, for the Aadhaar seal position (optional)'),
      '70843c25-8d80-40ac-ab6b-edba12abd495',
    );
    await user.click(screen.getByRole('button', { name: 'Check and save' }));
    const sent = actions.saveEsignCredentialsAction.mock.calls[0]![0] as FormData;
    expect(sent.get('v4Workflow')).toBe('70843c25-8d80-40ac-ab6b-edba12abd495');
    rerender(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign({
          ownAllowed: true,
          settings: { ...connected, own: { ...connected.own, sealPosition: true } },
        })}
      />,
    );
    expect(screen.getByTestId('esign-own-seal-position').textContent).toMatch(
      /Aadhaar seal position: on/,
    );
  });

  it('shows a saved account by its last characters only, and tests it', async () => {
    const user = userEvent.setup();
    actions.testEsignConnectionAction.mockResolvedValue({
      ok: true,
      data: { ok: true, message: 'Leegality accepted these details.' },
    });
    const { container } = render(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign({ ownAllowed: true, settings: connected, creditsRequired: true })}
      />,
    );
    const card = screen.getByTestId('esign-mode-own');
    expect(within(card).getByText('In use')).toBeTruthy();
    expect(within(card).getByText('9876')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Test connection' }));
    expect(await within(card).findByText('Leegality accepted these details.')).toBeTruthy();
    expect(container.querySelector('input[value]:not([value=""])')).toBeNull();
  });

  it('asks before removing the account', async () => {
    const user = userEvent.setup();
    actions.removeEsignCredentialsAction.mockResolvedValue({ ok: true, data: {} });
    render(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign({ ownAllowed: true, settings: connected })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(actions.removeEsignCredentialsAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(actions.removeEsignCredentialsAction).toHaveBeenCalledWith({ workspaceId: 'ws_1' });
  });

  it('lists recent eSigns with what happened to the credit', () => {
    const line = {
      ref: 'a',
      accountId: 'acct_1',
      workspaceId: 'ws_1',
      envelopeId: 'env_1',
      recipientId: 'r1',
      mode: 'platform' as const,
      billed: true,
      outcome: 'signed' as const,
      startedAt: '2026-11-23T10:00:00.000Z',
      endedAt: '2026-11-23T10:02:00.000Z',
      envelopeTitle: 'Appointment letter',
      workspaceName: 'Acme',
    };
    render(
      <EsignSettingsPanel
        workspaceId="ws_1"
        slug="acme"
        overview={esign({
          usage: [
            line,
            { ...line, ref: 'b', outcome: 'expired' },
            { ...line, ref: 'c', outcome: null },
          ],
        })}
      />,
    );
    const rows = within(screen.getByTestId('esign-usage')).getAllByRole('listitem');
    expect(rows[0]!.textContent).toMatch(/1 credit used.*Signed/);
    expect(rows[1]!.textContent).toMatch(/credit returned.*Expired/);
    expect(rows[2]!.textContent).toMatch(/1 credit held.*In progress/);
  });
});

describe('BillingPanel', () => {
  const panel = (overview = billing()) => (
    <BillingPanel workspaceId="ws_1" sellerStateCode="06" overview={overview} history={[]} />
  );

  it('shows the pack with GST worked out for the buyer state', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(panel());
    expect(screen.getByTestId('credit-price').textContent).toBe('₹35 per eSign');
    const summary = screen.getByTestId('pack-summary');
    expect(summary.textContent).toMatch(/IGST 18%/);
    expect(screen.getByTestId('pack-total').textContent).toBe('₹413');
    await user.click(screen.getByLabelText(/50 credits/));
    expect(screen.getByTestId('pack-total').textContent).toBe('₹2,065');
    expect(container.textContent).not.toMatch(/markup|at cost|provider cost/i);

    rerender(
      panel(billing({ details: { ...billing().details!, stateCode: '06', city: 'Gurugram' } })),
    );
  });

  it('splits the tax into CGST and SGST for a buyer in the seller state', () => {
    render(panel(billing({ details: { ...billing().details!, stateCode: '06' } })));
    const summary = screen.getByTestId('pack-summary').textContent;
    expect(summary).toMatch(/CGST 9%/);
    expect(summary).toMatch(/SGST 9%/);
  });

  it('pays through checkout and trusts only the server for the result', async () => {
    const user = userEvent.setup();
    actions.createCreditsOrderAction.mockResolvedValue({ ok: true, data: session });
    checkout.openCheckout.mockResolvedValue({
      orderId: 'order_1',
      paymentId: 'pay_1',
      signature: 's',
    });
    actions.confirmPaymentAction.mockResolvedValue({
      ok: true,
      data: {
        status: 'paid',
        invoiceId: 'inv_1',
        invoiceNumber: 'CV-2026270001',
        credits: { available: 13, reserved: 0 },
      },
    });
    render(panel());
    await user.click(screen.getByTestId('buy-credits'));
    await waitFor(() => expect(screen.getByTestId('purchase-paid')).toBeTruthy());
    expect(actions.createCreditsOrderAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      credits: 10,
    });
    expect(checkout.openCheckout).toHaveBeenCalledWith(session);
    expect(actions.confirmPaymentAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      orderId: 'order_1',
      paymentId: 'pay_1',
      signature: 's',
    });
    expect(screen.getByTestId('credits-available').textContent).toBe('13');
    expect(
      screen.getByRole('link', { name: 'Download invoice CV-2026270001' }).getAttribute('href'),
    ).toBe('/api/billing/workspaces/ws_1/invoices/inv_1');
  });

  it('adds nothing when the window is closed, and waits when the bank has not confirmed', async () => {
    const user = userEvent.setup();
    actions.createCreditsOrderAction.mockResolvedValue({ ok: true, data: session });
    checkout.openCheckout.mockResolvedValueOnce(null);
    render(panel());
    await user.click(screen.getByTestId('buy-credits'));
    await waitFor(() => expect(checkout.openCheckout).toHaveBeenCalledTimes(1));
    expect(actions.confirmPaymentAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('credits-available').textContent).toBe('3');

    checkout.openCheckout.mockResolvedValueOnce({
      orderId: 'order_1',
      paymentId: 'pay_1',
      signature: 's',
    });
    actions.confirmPaymentAction.mockResolvedValue({ ok: true, data: { status: 'pending' } });
    await user.click(screen.getByTestId('buy-credits'));
    expect((await screen.findByTestId('purchase-pending')).textContent).toMatch(
      /no need to pay again/,
    );
    expect(screen.getByTestId('credits-available').textContent).toBe('3');
  });

  it('says so when the payment window cannot load', async () => {
    const user = userEvent.setup();
    actions.createCreditsOrderAction.mockResolvedValue({ ok: true, data: session });
    checkout.openCheckout.mockRejectedValue(new Error('The payment window could not be loaded.'));
    render(panel());
    await user.click(screen.getByTestId('buy-credits'));
    expect((await screen.findByTestId('purchase-failed')).textContent).toMatch(
      /could not be loaded/,
    );
  });

  it('asks for billing details before the first purchase', async () => {
    const user = userEvent.setup();
    render(panel(billing({ details: null })));
    await user.click(screen.getByTestId('buy-credits'));
    expect(actions.createCreditsOrderAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('billing-details-form')).toBeTruthy();
    expect(screen.getByLabelText('GSTIN (optional)')).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(30);
  });

  it('shows a GSTIN problem next to its field', async () => {
    const user = userEvent.setup();
    actions.saveBillingDetailsAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'This GSTIN belongs to another state.',
      field: 'gstin',
    });
    render(panel());
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('GSTIN (optional)'), '06AANCC6406C1ZX');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/another state/);
    expect(screen.getByLabelText('GSTIN (optional)').getAttribute('aria-invalid')).toBe('true');
  });

  it('says coming soon instead of a price or a buy button until payments are on', () => {
    render(
      panel(
        billing({
          offer: {
            unavailable: 'payments_not_configured',
            pricePaise: null,
            packs: [10, 50, 200],
            gstPercent: 18,
            testMode: false,
          },
        }),
      ),
    );
    expect(screen.getByTestId('credit-price').textContent).toBe('Price coming soon');
    expect(screen.getByTestId('credits-unavailable').textContent).toMatch(/coming soon/);
    expect(screen.queryByTestId('buy-credits')).toBeNull();
  });

  it('lists invoices with a download link each', () => {
    render(
      panel(
        billing({
          invoices: [
            {
              id: 'inv_1',
              number: 'CV-2026270001',
              issuedAt: '2026-11-23T10:00:00.000Z',
              kind: 'esign_credits',
              description: 'Aadhaar eSign credits × 10 @ ₹35',
              taxablePaise: 35_000,
              taxPaise: 6_300,
              totalPaise: 41_300,
              test: false,
            },
          ],
        }),
      ),
    );
    const table = screen.getByTestId('invoices');
    expect(within(table).getByText('₹413')).toBeTruthy();
    expect(
      within(table)
        .getByRole('link', { name: 'Download invoice CV-2026270001' })
        .getAttribute('href'),
    ).toBe('/api/billing/workspaces/ws_1/invoices/inv_1');
  });
});
