// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  updateBrandAction: vi.fn(),
  uploadLogoAction: vi.fn(),
  removeLogoAction: vi.fn(),
  updateEmailSettingsAction: vi.fn(),
  updateSigningSettingsAction: vi.fn(),
}));
vi.mock('@/server/actions/brand', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { EmailBrandForm } = await import('./email-brand-form');
const { SigningBrandForm } = await import('./signing-brand-form');

const look = { brandColor: '#0F766E', logoUrl: null, showBadge: true };
const emailForm = (overrides = {}) => (
  <EmailBrandForm
    workspace={{ id: 'ws_1', name: 'Acme' }}
    values={{ senderName: '', replyTo: '', overrides }}
    look={look}
  />
);
const iframe = () => screen.getByTitle(/email preview/) as HTMLIFrameElement;

beforeEach(() => {
  actions.updateEmailSettingsAction.mockResolvedValue({ ok: true, data: undefined });
  actions.updateSigningSettingsAction.mockResolvedValue({ ok: true, data: undefined });
});

describe('EmailBrandForm', () => {
  it('previews the default invitation in a sandboxed frame', () => {
    render(emailForm());
    expect(screen.getByTestId('preview-subject')).toHaveTextContent('Please sign "Offer letter"');
    expect(screen.getByTestId('preview-from')).toHaveTextContent('Acme');
    expect(iframe().getAttribute('sandbox')).toBe('');
    expect(iframe().getAttribute('srcdoc')).toContain('Acme has asked you to sign');
  });

  it('updates the preview as the subject, text and sender name change', async () => {
    const user = userEvent.setup();
    render(emailForm());
    await user.type(screen.getByLabelText('Sender name'), 'Acme People');
    await user.type(screen.getByLabelText('Opening text'), '<b>Welcome</b>');
    expect(iframe().getAttribute('srcdoc')).toContain('&lt;b&gt;Welcome&lt;/b&gt;');
    await user.type(screen.getByLabelText('Subject'), 'Action needed: ');
    await user.click(screen.getByRole('button', { name: '{{document_title}}' }));
    expect(screen.getByTestId('preview-subject')).toHaveTextContent('Action needed: Offer letter');
    expect(screen.getByTestId('preview-from')).toHaveTextContent('Acme People');
  });

  it('offers only the variables each email has and keeps each tab apart', async () => {
    const user = userEvent.setup();
    render(emailForm({ invite: { subject: 'Invite me' } }));
    expect(screen.queryByRole('button', { name: '{{status}}' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Cancelled' }));
    expect(screen.getByRole('tab', { name: 'Cancelled' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '{{status}}' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '{{action}}' })).toBeNull();
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByTestId('preview-subject')).toHaveTextContent('Cancelled: "Offer letter"');
    await user.click(screen.getByRole('tab', { name: /Invitation/ }));
    expect(screen.getByLabelText('Subject')).toHaveValue('Invite me');
    await user.click(screen.getByRole('button', { name: /Use the default invitation text/ }));
    expect(screen.getByLabelText('Subject')).toHaveValue('');
  });

  it('saves every override and the sender details together', async () => {
    const user = userEvent.setup();
    render(emailForm());
    await user.type(screen.getByLabelText('Reply-to address'), 'hr@acme.test');
    await user.click(screen.getByRole('tab', { name: 'Reminder' }));
    await user.type(screen.getByLabelText('Subject'), 'Nudge');
    await user.click(screen.getByRole('button', { name: 'Save email settings' }));
    expect(actions.updateEmailSettingsAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      senderName: '',
      replyTo: 'hr@acme.test',
      overrides: { reminder: { subject: 'Nudge' } },
    });
  });

  it('opens the email whose text was refused and shows why next to it', async () => {
    const user = userEvent.setup();
    actions.updateEmailSettingsAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: '{{status}} is not available in this email.',
      field: 'overrides.reminder.intro',
    });
    render(emailForm({ reminder: { intro: '{{status}}' } }));
    await user.click(screen.getByRole('button', { name: 'Save email settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not available');
    expect(screen.getByRole('tab', { name: /Reminder/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Opening text')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('SigningBrandForm', () => {
  const values = {
    showBadge: true,
    certificateFooter: '',
    signingDomain: '',
    signingDomainVerified: false,
  };

  it('saves the badge, footer and domain', async () => {
    const user = userEvent.setup();
    render(<SigningBrandForm workspaceId="ws_1" appHost="app.example.com" values={values} />);
    expect(screen.queryByTestId('dns-instructions')).toBeNull();
    await user.click(screen.getByRole('switch', { name: /Secured by Codevibe Sign/ }));
    await user.type(screen.getByLabelText('Certificate footer'), 'Acme Pvt Ltd');
    await user.type(screen.getByLabelText('Signing page domain'), 'sign.acme.com');
    await user.click(screen.getByRole('button', { name: 'Save signing page settings' }));
    expect(actions.updateSigningSettingsAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      showBadge: false,
      certificateFooter: 'Acme Pvt Ltd',
      signingDomain: 'sign.acme.com',
    });
  });

  it('shows the DNS record for a saved domain and whether it is connected', () => {
    const { rerender } = render(
      <SigningBrandForm
        workspaceId="ws_1"
        appHost="app.example.com"
        values={{ ...values, signingDomain: 'sign.acme.com' }}
      />,
    );
    const dns = screen.getByTestId('dns-instructions');
    expect(dns).toHaveTextContent('Waiting for DNS');
    expect(dns).toHaveTextContent('CNAME');
    expect(dns).toHaveTextContent('app.example.com');
    rerender(
      <SigningBrandForm
        workspaceId="ws_1"
        appHost="app.example.com"
        values={{ ...values, signingDomain: 'sign.acme.com', signingDomainVerified: true }}
      />,
    );
    expect(screen.getByTestId('dns-instructions')).toHaveTextContent('Connected');
  });

  it('puts a refused domain next to the field', async () => {
    const user = userEvent.setup();
    actions.updateSigningSettingsAction.mockResolvedValue({
      ok: false,
      code: 'CONFLICT',
      error: 'Another workspace already uses this domain.',
      field: 'signingDomain',
    });
    render(<SigningBrandForm workspaceId="ws_1" appHost="app.example.com" values={values} />);
    await user.type(screen.getByLabelText('Signing page domain'), 'taken.example.com');
    await user.click(screen.getByRole('button', { name: 'Save signing page settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already uses');
    expect(screen.getByLabelText('Signing page domain')).toHaveAttribute('aria-invalid', 'true');
  });
});
