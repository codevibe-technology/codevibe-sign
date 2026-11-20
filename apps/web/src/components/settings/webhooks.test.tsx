// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actions: {
    createWebhookAction: vi.fn(),
    updateWebhookAction: vi.fn(),
    setWebhookEnabledAction: vi.fn(),
    rollWebhookSecretAction: vi.fn(),
    deleteWebhookAction: vi.fn(),
    testWebhookAction: vi.fn(),
    retryDeliveryAction: vi.fn(),
  },
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/actions/webhooks', () => mocks.actions);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const { WebhooksPanel } = await import('./webhooks-panel');
const { WebhookDetail, outcomeMessage } = await import('./webhook-detail');

const webhook = {
  id: 'wh_1',
  url: 'https://hooks.example.com/sign',
  description: 'HR system',
  events: ['envelope.completed', 'envelope.declined'],
  enabled: true,
  lastDelivery: { status: 'failed' as const, at: new Date().toISOString() },
};
const delivery = {
  deliveryId: 'd_1',
  event: 'envelope.completed',
  body: '{"id":"d_1","type":"envelope.completed"}',
  status: 'retrying' as const,
  attempts: 2,
  responseStatus: 401,
  error: 'Webhook hooks.example.com answered 401',
  nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
  durationMs: 85,
  createdAt: new Date().toISOString(),
  lastAttemptAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WebhooksPanel', () => {
  it('explains webhooks when there are none', () => {
    render(<WebhooksPanel slug="acme" workspaceId="ws_1" webhooks={[]} allowInsecure={false} />);
    expect(screen.getByText('No endpoints yet')).toBeInTheDocument();
  });

  it('lists endpoints with their events and last delivery', () => {
    render(
      <WebhooksPanel
        slug="acme"
        workspaceId="ws_1"
        webhooks={[
          webhook,
          {
            ...webhook,
            id: 'wh_2',
            url: 'https://b.example.com',
            enabled: false,
            lastDelivery: null,
            events: ['*'],
          },
        ]}
        allowInsecure={false}
      />,
    );
    const [first, second] = screen.getAllByRole('link');
    expect(first).toHaveAttribute('href', '/w/acme/settings/webhooks/wh_1');
    expect(
      within(first!).getByText(/HR system · envelope.completed, envelope.declined/),
    ).toBeInTheDocument();
    expect(within(first!).getByText('Failed')).toBeInTheDocument();
    expect(within(second!).getByText('Off')).toBeInTheDocument();
    expect(within(second!).getByText(/All events/)).toBeInTheDocument();
  });

  it('checks the form, then shows the secret once', async () => {
    const user = userEvent.setup();
    mocks.actions.createWebhookAction.mockResolvedValue({
      ok: true,
      data: { id: 'wh_9', secret: 'whsec_shown_once' },
    });
    render(<WebhooksPanel slug="acme" workspaceId="ws_1" webhooks={[]} allowInsecure={false} />);
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Endpoint URL'), 'http://hooks.example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }));
    expect(within(dialog).getByText(/Use an https:\/\/ URL/)).toBeInTheDocument();
    expect(mocks.actions.createWebhookAction).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText('Endpoint URL'));
    await user.type(
      within(dialog).getByLabelText('Endpoint URL'),
      'https://hooks.example.com/sign',
    );
    await user.click(within(dialog).getByRole('checkbox', { name: /Sealed/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }));
    await waitFor(() => expect(mocks.actions.createWebhookAction).toHaveBeenCalled());
    expect(mocks.actions.createWebhookAction.mock.calls[0]![0]).toEqual({
      workspaceId: 'ws_1',
      url: 'https://hooks.example.com/sign',
      description: '',
      events: ['envelope.completed', 'envelope.declined', 'envelope.voided', 'document.sealed'],
    });
    expect((await screen.findByTestId('webhook-secret')).textContent).toBe('whsec_shown_once');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('whsec_shown_once');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('whsec_shown_once')).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith('/w/acme/settings/webhooks/wh_9');
  });

  it('puts a refused URL next to the field and can subscribe to everything', async () => {
    const user = userEvent.setup();
    mocks.actions.createWebhookAction.mockResolvedValue({
      ok: false,
      code: 'CONFLICT',
      error: 'This workspace already sends to that URL.',
      field: 'url',
    });
    render(<WebhooksPanel slug="acme" workspaceId="ws_1" webhooks={[]} allowInsecure />);
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/http:\/\/ is allowed/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Endpoint URL'), 'http://localhost:4000/hook');
    await user.click(within(dialog).getByRole('radio', { name: /All events/ }));
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }));
    expect(
      await within(dialog).findByText('This workspace already sends to that URL.'),
    ).toBeInTheDocument();
    expect(mocks.actions.createWebhookAction.mock.calls[0]![0].events).toEqual(['*']);
  });
});

describe('WebhookDetail', () => {
  const renderDetail = (props: Partial<Parameters<typeof WebhookDetail>[0]> = {}) =>
    render(
      <WebhookDetail
        slug="acme"
        workspaceId="ws_1"
        webhook={webhook}
        deliveries={[delivery]}
        filter="all"
        allowInsecure={false}
        {...props}
      />,
    );

  it('sends a test event and says what the receiver answered', async () => {
    const user = userEvent.setup();
    mocks.actions.testWebhookAction.mockResolvedValue({
      ok: true,
      data: { outcome: 'delivered', status: 204, error: null },
    });
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Send test event' }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Test event delivered: your server answered 204.',
      ),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('cannot test an endpoint that is off', () => {
    renderDetail({ webhook: { ...webhook, enabled: false } });
    expect(screen.getByRole('button', { name: 'Send test event' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('opens a delivery with its payload, hint and retry', async () => {
    const user = userEvent.setup();
    mocks.actions.retryDeliveryAction.mockResolvedValue({
      ok: true,
      data: { outcome: 'failed', status: 401, error: 'x' },
    });
    renderDetail();
    const row = screen.getByRole('button', { name: /envelope.completed/ });
    expect(within(row).getByText('Retrying')).toBeInTheDocument();
    expect(within(row).getByText(/HTTP 401 · 2 attempts/)).toBeInTheDocument();
    await user.click(row);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('payload').textContent).toBe(
      '{\n  "id": "d_1",\n  "type": "envelope.completed"\n}',
    );
    expect(within(dialog).getByRole('note')).toHaveTextContent(/current secret/);
    await user.click(within(dialog).getByRole('button', { name: 'Send again' }));
    await waitFor(() =>
      expect(mocks.actions.retryDeliveryAction).toHaveBeenCalledWith({
        workspaceId: 'ws_1',
        webhookId: 'wh_1',
        deliveryId: 'd_1',
      }),
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Delivery failed\. Your server refused it \(401\)/),
    );
  });

  it('rolls the secret only after asking, and shows the new one once', async () => {
    const user = userEvent.setup();
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    mocks.actions.rollWebhookSecretAction.mockResolvedValue({
      ok: true,
      data: { secret: 'whsec_new' },
    });
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'New secret' }));
    expect(mocks.actions.rollWebhookSecretAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'New secret' }));
    expect((await screen.findByTestId('webhook-secret')).textContent).toBe('whsec_new');
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('edits the endpoint and removes it', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.actions.updateWebhookAction.mockResolvedValue({ ok: true, data: undefined });
    mocks.actions.deleteWebhookAction.mockResolvedValue({ ok: true, data: undefined });
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Endpoint URL')).toHaveValue(webhook.url);
    expect(within(dialog).getByRole('checkbox', { name: /Completed/ })).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: /envelope\.declined/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.actions.updateWebhookAction).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: 'wh_1', events: ['envelope.completed'] }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/w/acme/settings/webhooks'));
  });

  it('says when no delivery failed', () => {
    renderDetail({ deliveries: [], filter: 'problems' });
    expect(screen.getByText('No failed deliveries')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Failed' })).toHaveAttribute('aria-current', 'page');
  });

  it('words outcomes for people', () => {
    expect(outcomeMessage('Test event', { outcome: 'skipped', status: null, error: null })).toEqual(
      {
        ok: false,
        text: 'Test event not sent: the endpoint is off.',
      },
    );
    expect(
      outcomeMessage('Test event', { outcome: 'failed', status: null, error: 'timeout' }).text,
    ).toMatch(/10 seconds/);
  });
});
