// @vitest-environment jsdom
import type { Envelope } from '@codevibe_technology/sign-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shareLinkAction: vi.fn(),
  correctRecipientAction: vi.fn(),
  recallEnvelopeAction: vi.fn(),
  reviseEnvelopeAction: vi.fn(),
  remindAction: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/server/actions/envelopes', () => ({
  shareLinkAction: mocks.shareLinkAction,
  correctRecipientAction: mocks.correctRecipientAction,
  recallEnvelopeAction: mocks.recallEnvelopeAction,
  reviseEnvelopeAction: mocks.reviseEnvelopeAction,
  remindAction: mocks.remindAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const { RecipientsCard } = await import('./envelope-detail');
const { DeclineBanner } = await import('./decline-banner');
const { RecallButton, ReviseButton } = await import('./copy-dialogs');

const envelope: Envelope = {
  id: 'env_1',
  title: 'Offer letter',
  status: 'in_progress',
  routing: 'sequential',
  documents: [],
  recipients: [
    {
      id: 'r1',
      name: 'Ravi',
      email: 'ravi@example.com',
      role: 'signer',
      order: 1,
      auth: 'email_link',
      status: 'signed',
      actedAt: '2026-11-19T10:00:00.000Z',
    },
    {
      id: 'r2',
      name: 'Mia',
      email: 'mia@example.com',
      role: 'signer',
      order: 2,
      auth: 'email_otp',
      status: 'notified',
    },
    {
      id: 'r3',
      name: 'Lee',
      email: 'lee@example.com',
      role: 'approver',
      order: 3,
      auth: 'email_link',
      status: 'pending',
    },
  ],
  fields: [],
  values: [],
  reminders: { firstAfterDays: 2, everyDays: 2, max: 5 },
  createdAt: '2026-11-18T10:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

describe('fixing recipients', () => {
  const card = (props: { canShareLinks?: boolean; canCorrect?: boolean }) =>
    render(
      <RecipientsCard
        workspaceId="ws_1"
        envelope={envelope}
        currentIds={['r2']}
        canRemind
        {...props}
      />,
    );

  it('offers a link to share for whoever is next, to admins only', () => {
    card({ canShareLinks: true });
    const items = screen.getAllByRole('listitem');
    expect(within(items[1]!).getByRole('button', { name: 'Get a link to share' })).toBeTruthy();
    expect(within(items[0]!).queryByRole('button', { name: 'Get a link to share' })).toBeNull();
    expect(within(items[2]!).queryByRole('button', { name: 'Get a link to share' })).toBeNull();
  });

  it('hides the link from people without the right', () => {
    card({ canShareLinks: false });
    expect(screen.queryByRole('button', { name: 'Get a link to share' })).toBeNull();
  });

  it('lets senders correct only people who have not acted, and points at recall', () => {
    card({ canCorrect: true });
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).queryByRole('button', { name: 'Correct' })).toBeNull();
    expect(within(items[1]!).getByRole('button', { name: 'Correct' })).toBeTruthy();
    expect(within(items[2]!).getByRole('button', { name: 'Correct' })).toBeTruthy();
    expect(screen.getByText(/Use Recall and edit/)).toBeTruthy();
  });

  it('shows the link once with the warning, copies it, and forgets it on close', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mocks.shareLinkAction.mockResolvedValue({
      ok: true,
      data: { url: 'https://sign.example.com/api/sign/secret-token' },
    });
    card({ canShareLinks: true });
    await user.click(screen.getByRole('button', { name: 'Get a link to share' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Anyone with this link can sign as Mia. Send it only to them, for example on WhatsApp.',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Signing link' })).toHaveValue(
      'https://sign.example.com/api/sign/secret-token',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://sign.example.com/api/sign/secret-token');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByDisplayValue(/secret-token/)).toBeNull();
    expect(mocks.shareLinkAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      envelopeId: 'env_1',
      recipientId: 'r2',
    });
  });

  it('shows a refusal, such as the hourly limit, instead of a link', async () => {
    const user = userEvent.setup();
    mocks.shareLinkAction.mockResolvedValue({
      ok: false,
      code: 'CONFLICT',
      error: '5 links were already taken for this person in the last hour. Try again later.',
    });
    card({ canShareLinks: true });
    await user.click(screen.getByRole('button', { name: 'Get a link to share' }));
    expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/5 links/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('corrects an address and says a new invitation went out', async () => {
    const user = userEvent.setup();
    mocks.correctRecipientAction.mockResolvedValue({ ok: true, data: { invited: true } });
    card({ canCorrect: true });
    await user.click(
      within(screen.getAllByRole('listitem')[1]!).getByRole('button', { name: 'Correct' }),
    );
    const dialog = await screen.findByRole('dialog');
    const email = within(dialog).getByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'mia.k@example.com');
    expect(dialog).toHaveTextContent('the new address gets an invitation now');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.correctRecipientAction).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'r2', email: 'mia.k@example.com', name: 'Mia' }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringMatching(/new invitation/));
  });

  it('offers a new invitation when only the name changes', async () => {
    const user = userEvent.setup();
    mocks.correctRecipientAction.mockResolvedValue({ ok: true, data: { invited: true } });
    card({ canCorrect: true });
    await user.click(
      within(screen.getAllByRole('listitem')[1]!).getByRole('button', { name: 'Correct' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), ' Khan');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Send a new invitation' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.correctRecipientAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Mia Khan', resend: true }),
    );
  });
});

describe('DeclineBanner', () => {
  const declined: Envelope = {
    ...envelope,
    status: 'declined',
    recipients: [
      {
        ...envelope.recipients[2]!,
        name: 'Satyam Patel',
        status: 'declined',
        actedAt: '2026-11-19T10:00:00.000Z',
        declineReason: 'The notice period should be 30 days.\nPlease fix clause 4.',
      },
    ],
  };

  it('shows who declined, their role, when and their reason in full', () => {
    render(<DeclineBanner envelope={declined} action={<button type="button">Revise</button>} />);
    const banner = screen.getByRole('region', { name: 'Declined' });
    expect(banner).toHaveTextContent('Declined by Satyam Patel (approver)');
    expect(banner).toHaveTextContent('The notice period should be 30 days.');
    expect(banner).toHaveTextContent('Please fix clause 4.');
    expect(within(banner).getByRole('button', { name: 'Revise' })).toBeTruthy();
  });

  it('shows nothing for envelopes that were not declined', () => {
    const { container } = render(<DeclineBanner envelope={envelope} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('recall and revise buttons', () => {
  it('warns that signatures are not kept, then opens the draft copy', async () => {
    const user = userEvent.setup();
    mocks.recallEnvelopeAction.mockResolvedValue({ ok: true, data: { draftId: 'env_copy' } });
    render(
      <RecallButton slug="acme" workspaceId="ws_1" envelope={{ id: 'env_1', title: 'Offer' }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Recall and edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Anyone who already signed will need to sign again.');
    await user.type(within(dialog).getByRole('textbox'), 'Wrong date');
    await user.click(within(dialog).getByRole('button', { name: 'Recall and edit' }));
    expect(mocks.recallEnvelopeAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      envelopeId: 'env_1',
      note: 'Wrong date',
    });
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith('/dashboard/acme/envelopes/new?draft=env_copy'),
    );
  });

  it('revises a declined envelope into a draft and opens it', async () => {
    const user = userEvent.setup();
    mocks.reviseEnvelopeAction.mockResolvedValue({ ok: true, data: { draftId: 'env_rev' } });
    render(<ReviseButton slug="acme" workspaceId="ws_1" envelopeId="env_1" />);
    await user.click(screen.getByRole('button', { name: 'Revise and resend' }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith('/dashboard/acme/envelopes/new?draft=env_rev'),
    );
  });
});
