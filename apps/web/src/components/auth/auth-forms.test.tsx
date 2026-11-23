// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn(), magicLink: vi.fn(), social: vi.fn() },
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));
const actions = vi.hoisted(() => ({
  joinWithPasswordAction: vi.fn(),
  setPasswordAction: vi.fn(),
  signOutOtherSessionsAction: vi.fn(),
  acceptInvitationAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/auth-client', () => ({ authClient: client }));
vi.mock('@/server/actions/account', () => actions);
vi.mock('@/server/actions/team', () => actions);
vi.mock('sonner', () => ({ toast }));

const { SignInForm } = await import('@/app/(auth)/sign-in/sign-in-form');
const { ForgotPasswordForm } = await import('@/app/(auth)/forgot-password/forgot-password-form');
const { ResetPasswordForm } = await import('@/app/(auth)/reset-password/reset-password-form');
const { JoinForm } = await import('@/app/invite/[token]/join-form');
const { AcceptInvitation } = await import('@/app/invite/[token]/accept-invitation');
const { PasswordForm } = await import('@/components/settings/password-form');

const GOOD = 'mango-river-lantern';
const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

describe('SignInForm', () => {
  const form = (props: Partial<Parameters<typeof SignInForm>[0]> = {}) =>
    render(<SignInForm next="/dashboard" google={false} failed={false} {...props} />);

  it('signs in with an email and password and goes on to the dashboard', async () => {
    const user = userEvent.setup();
    client.signIn.email.mockResolvedValue({ error: null });
    form();
    await user.type(screen.getByLabelText('Work email'), ' asha@example.com ');
    await user.type(screen.getByLabelText('Password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(client.signIn.email).toHaveBeenCalledWith({ email: 'asha@example.com', password: GOOD });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard'));
    expect(client.signIn.magicLink).not.toHaveBeenCalled();
  });

  it('goes back to the page that asked for the sign-in', async () => {
    const user = userEvent.setup();
    client.signIn.email.mockResolvedValue({ error: null });
    form({ next: '/invite/abc' });
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/invite/abc'));
  });

  it('says the same thing for any wrong pair and points at the link', async () => {
    const user = userEvent.setup();
    client.signIn.email.mockResolvedValue({ error: { status: 401, message: 'Invalid' } });
    form();
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match. Check them, or use "Email me a link instead".',
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows how long password sign-in is paused', async () => {
    const user = userEvent.setup();
    client.signIn.email.mockResolvedValue({
      error: { status: 429, message: 'Too many wrong passwords. Try again in 12 minutes.' },
    });
    form();
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 12 minutes');
  });

  it('asks for a real email and a password before calling anything', async () => {
    const user = userEvent.setup();
    form();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your work email');
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password');
    expect(client.signIn.email).not.toHaveBeenCalled();
  });

  it('still emails a link, keeping the address already typed', async () => {
    const user = userEvent.setup();
    client.signIn.magicLink.mockResolvedValue({ error: null });
    form({ next: '/dashboard/acme/envelopes' });
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a link instead' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(client.signIn.magicLink).toHaveBeenCalledWith({
      email: 'asha@example.com',
      callbackURL: '/dashboard/acme/envelopes',
      newUserCallbackURL: '/dashboard/acme/envelopes',
      errorCallbackURL: '/sign-in?error=link',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a sign-in link to');
    expect(client.signIn.email).not.toHaveBeenCalled();
  });

  it('can switch back to the password', async () => {
    const user = userEvent.setup();
    form();
    await user.click(screen.getByRole('button', { name: 'Email me a link instead' }));
    await user.click(screen.getByRole('button', { name: 'Use my password instead' }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('carries the typed address to "Forgot password"', async () => {
    const user = userEvent.setup();
    form();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await user.type(screen.getByLabelText('Work email'), 'asha+hr@example.com');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password?email=asha%2Bhr%40example.com',
    );
  });

  it('shows and hides the password on request', async () => {
    const user = userEvent.setup();
    form();
    const box = screen.getByLabelText('Password');
    expect(box).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(box).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(box).toHaveAttribute('type', 'password');
  });

  it('says so after a password reset and after a dead link', () => {
    form({ notice: 'Your password was changed. Sign in with the new one.' });
    expect(screen.getByRole('status')).toHaveTextContent('Your password was changed');
    form({ failed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('expired or was already used');
  });
});

describe('ForgotPasswordForm', () => {
  it('asks for the link and answers the same for any address', async () => {
    const user = userEvent.setup();
    client.requestPasswordReset.mockResolvedValue({ error: null });
    render(<ForgotPasswordForm email="asha@example.com" />);
    expect(screen.getByLabelText('Work email')).toHaveValue('asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));
    expect(client.requestPasswordReset).toHaveBeenCalledWith({
      email: 'asha@example.com',
      redirectTo: '/reset-password',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If asha@example.com has an account, we sent it a link',
    );
  });

  it('refuses something that is not an email, and says when it could not send', async () => {
    const user = userEvent.setup();
    client.requestPasswordReset.mockResolvedValue({ error: { status: 500 } });
    render(<ForgotPasswordForm email="" />);
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your work email');
    expect(client.requestPasswordReset).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not send the email');
  });
});

describe('ResetPasswordForm', () => {
  it('saves a good password and sends the person to sign in', async () => {
    const user = userEvent.setup();
    client.resetPassword.mockResolvedValue({ error: null });
    render(<ResetPasswordForm token="tok_12345678" />);
    await user.type(screen.getByLabelText('New password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(client.resetPassword).toHaveBeenCalledWith({ newPassword: GOOD, token: 'tok_12345678' });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in?reset=1'));
  });

  it('explains a weak password before sending it', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="tok_12345678" />);
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 10 characters');
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('first anyone would guess');
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it('says when the link is spent and offers a new one', async () => {
    const user = userEvent.setup();
    client.resetPassword.mockResolvedValue({ error: { status: 400, code: 'INVALID_TOKEN' } });
    render(<ResetPasswordForm token="tok_12345678" />);
    await user.type(screen.getByLabelText('New password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your password was not changed');
    expect(screen.getByRole('link', { name: 'Send a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('JoinForm', () => {
  const props = { token: 'inv_token', email: 'ravi@example.com', signInHref: '/sign-in?next=x' };

  it('creates the account, signs in, accepts and opens the workspace', async () => {
    const user = userEvent.setup();
    actions.joinWithPasswordAction.mockResolvedValue({
      ok: true,
      data: { email: 'ravi@example.com' },
    });
    client.signIn.email.mockResolvedValue({ error: null });
    actions.acceptInvitationAction.mockResolvedValue({
      ok: true,
      data: { workspaceSlug: 'acme' },
    });
    render(<JoinForm {...props} />);
    expect(screen.getByLabelText('Email')).toHaveValue('ravi@example.com');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    await user.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Choose a password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard/acme'));
    expect(actions.joinWithPasswordAction).toHaveBeenCalledWith({
      token: 'inv_token',
      name: 'Ravi Kumar',
      password: GOOD,
    });
    expect(client.signIn.email).toHaveBeenCalledWith({ email: 'ravi@example.com', password: GOOD });
    expect(actions.acceptInvitationAction).toHaveBeenCalledWith({ token: 'inv_token' });
  });

  it('checks the name and the password first, against the invited address too', async () => {
    const user = userEvent.setup();
    render(<JoinForm {...props} />);
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
    await user.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Choose a password'), 'ravi-kumar-2026');
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(screen.getByRole('alert')).toHaveTextContent('email address or name');
    expect(actions.joinWithPasswordAction).not.toHaveBeenCalled();
  });

  it('starts from the name on the invitation and holds it to the name rule', async () => {
    const user = userEvent.setup();
    render(<JoinForm {...props} suggestedName="Ravi Kumar" />);
    const name = screen.getByLabelText('Your name');
    expect(name).toHaveValue('Ravi Kumar');
    await user.clear(name);
    await user.type(name, 'R');
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 2 characters');
    expect(actions.joinWithPasswordAction).not.toHaveBeenCalled();
  });

  it('sends someone who already has an account to sign in', async () => {
    const user = userEvent.setup();
    actions.joinWithPasswordAction.mockResolvedValue({
      ok: false,
      code: 'CONFLICT',
      error: 'You already have an account with this email. Sign in to accept the invitation.',
    });
    render(<JoinForm {...props} />);
    await user.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Choose a password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have an account');
    expect(screen.getByRole('link', { name: 'Sign in to accept' })).toHaveAttribute(
      'href',
      '/sign-in?next=x',
    );
    expect(client.signIn.email).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('puts the server’s word on the password next to it', async () => {
    const user = userEvent.setup();
    actions.joinWithPasswordAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'That password is one of the first anyone would guess. Pick something less common.',
      field: 'newPassword',
    });
    render(<JoinForm {...props} />);
    await user.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Choose a password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('first anyone would guess');
    expect(screen.getByLabelText('Choose a password')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('AcceptInvitation', () => {
  beforeEach(() => {
    router.push.mockReset();
    actions.acceptInvitationAction.mockReset();
    actions.acceptInvitationAction.mockResolvedValue({ ok: true, data: { workspaceSlug: 'acme' } });
  });

  it('accepts with one press for someone who has a name', async () => {
    const user = userEvent.setup();
    render(<AcceptInvitation token="inv_token" />);
    expect(screen.queryByLabelText('Your name')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(actions.acceptInvitationAction).toHaveBeenCalledWith({ token: 'inv_token' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/dashboard/acme'));
  });

  it('asks someone without a name for it, starting from the invitation', async () => {
    const user = userEvent.setup();
    render(<AcceptInvitation token="inv_token" askName suggestedName="Ravi Kumar" />);
    const name = screen.getByLabelText('Your name');
    expect(name).toHaveValue('Ravi Kumar');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
    expect(actions.acceptInvitationAction).not.toHaveBeenCalled();
    await user.type(name, 'Ravi K. Kumar');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(actions.acceptInvitationAction).toHaveBeenCalledWith({
      token: 'inv_token',
      name: 'Ravi K. Kumar',
    });
  });

  it('shows the server’s word on the name next to the field', async () => {
    const user = userEvent.setup();
    actions.acceptInvitationAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'A name needs at least one letter',
      field: 'name',
    });
    render(<AcceptInvitation token="inv_token" askName suggestedName="Ravi" />);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one letter');
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('PasswordForm', () => {
  const account = { name: 'Asha Rao', email: 'asha@example.com' };

  it('sets a first password without asking for a current one', async () => {
    const user = userEvent.setup();
    actions.setPasswordAction.mockResolvedValue({ ok: true, data: { hadPassword: false } });
    render(<PasswordForm user={account} hasPassword={false} />);
    expect(screen.queryByLabelText('Current password')).toBeNull();
    await user.type(screen.getByLabelText('Password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(actions.setPasswordAction).toHaveBeenCalledWith({
      newPassword: GOOD,
      signOutOthers: true,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password set'));
    expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
  });

  it('changes it with the current one and can leave other devices signed in', async () => {
    const user = userEvent.setup();
    actions.setPasswordAction.mockResolvedValue({ ok: true, data: { hadPassword: true } });
    render(<PasswordForm user={account} hasPassword />);
    await user.type(screen.getByLabelText('Current password'), GOOD);
    await user.type(screen.getByLabelText('New password'), 'seven quiet copper kettles');
    await user.click(screen.getByRole('checkbox', { name: /Sign out my other devices/ }));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(actions.setPasswordAction).toHaveBeenCalledWith({
      newPassword: 'seven quiet copper kettles',
      currentPassword: GOOD,
      signOutOthers: false,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password changed'));
  });

  it('shows a wrong current password next to that field', async () => {
    const user = userEvent.setup();
    actions.setPasswordAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'That is not your current password',
      field: 'currentPassword',
    });
    render(<PasswordForm user={account} hasPassword />);
    await user.type(screen.getByLabelText('Current password'), 'not-the-password');
    await user.type(screen.getByLabelText('New password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That is not your current password');
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a password built from the person’s own name before sending it', async () => {
    const user = userEvent.setup();
    render(<PasswordForm user={account} hasPassword={false} />);
    await user.type(screen.getByLabelText('Password'), 'asha rao 2026!');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('email address or name');
    expect(actions.setPasswordAction).not.toHaveBeenCalled();
  });

  it('signs the other sessions out on request', async () => {
    const user = userEvent.setup();
    actions.signOutOtherSessionsAction.mockResolvedValue({ ok: true, data: undefined });
    render(<PasswordForm user={account} hasPassword />);
    await user.click(screen.getByRole('button', { name: 'Sign out other sessions' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Signed out on your other devices'),
    );
    expect(actions.signOutOtherSessionsAction).toHaveBeenCalledWith({});
  });
});
