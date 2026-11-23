// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn(), magicLink: vi.fn(), social: vi.fn() },
  requestPasswordReset: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({ authClient: client }));

const { SignInForm } = await import('@/app/(auth)/sign-in/sign-in-form');
const { ForgotPasswordForm } = await import('@/app/(auth)/forgot-password/forgot-password-form');

type Options = { callback: (token: string) => void; 'error-callback': () => void };

/** A stand-in for Cloudflare's script: hands out numbered tokens, or fails when told to. */
function fakeTurnstile(mode: 'pass' | 'error' = 'pass') {
  let issued = 0;
  const widgets: Options[] = [];
  const issue = (options: Options) =>
    setTimeout(() =>
      mode === 'pass' ? options.callback(`token-${++issued}`) : options['error-callback'](),
    );
  window.turnstile = {
    render: vi.fn((_el: HTMLElement, options: Options) => {
      widgets.push(options);
      issue(options);
      return `w${widgets.length}`;
    }),
    reset: vi.fn((id: string) => issue(widgets[Number(id.slice(1)) - 1]!)),
    remove: vi.fn(),
  } as unknown as NonNullable<Window['turnstile']>;
  return window.turnstile;
}

const assign = vi.fn();
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});
afterEach(() => {
  delete window.turnstile;
});

describe('the human check on sign-in', () => {
  it('sends a fresh token with each request and starts a new check after it', async () => {
    const turnstile = fakeTurnstile();
    const user = userEvent.setup();
    client.signIn.email.mockResolvedValue({ error: { status: 401, message: 'nope' } });
    render(<SignInForm next="/dashboard" google={false} failed={false} humanCheckKey="site" />);
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled());
    expect(vi.mocked(turnstile.render).mock.calls[0]![1]).toMatchObject({
      sitekey: 'site',
      theme: 'light',
      appearance: 'interaction-only',
      action: 'sign-in',
    });
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'mango-river-lantern');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(client.signIn.email).toHaveBeenCalledTimes(1));
    expect(client.signIn.email).toHaveBeenLastCalledWith({
      email: 'asha@example.com',
      password: 'mango-river-lantern',
      fetchOptions: { headers: { 'x-turnstile-token': 'token-1' } },
    });
    expect(turnstile.reset).toHaveBeenCalledWith('w1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(client.signIn.email).toHaveBeenCalledTimes(2));
    expect(client.signIn.email.mock.calls[1]![0].fetchOptions.headers['x-turnstile-token']).toBe(
      'token-2',
    );
  });

  it('puts the token on a sign-in link request too', async () => {
    fakeTurnstile();
    const user = userEvent.setup();
    client.signIn.magicLink.mockResolvedValue({ error: null });
    render(<SignInForm next="/dashboard" google={false} failed={false} humanCheckKey="site" />);
    await user.click(screen.getByRole('button', { name: 'Email me a link instead' }));
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    await waitFor(() => expect(client.signIn.magicLink).toHaveBeenCalled());
    expect(client.signIn.magicLink.mock.calls[0]![0]).toMatchObject({
      email: 'asha@example.com',
      fetchOptions: { headers: { 'x-turnstile-token': 'token-1' } },
    });
  });

  it('shows what to do and sends nothing when the check fails', async () => {
    fakeTurnstile('error');
    const user = userEvent.setup();
    client.signIn.email.mockReset();
    render(<SignInForm next="/dashboard" google={false} failed={false} humanCheckKey="site" />);
    await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'mango-river-lantern');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/security check expired or did not pass/)).toBeInTheDocument();
    expect(client.signIn.email).not.toHaveBeenCalled();
  });

  it('shows the server refusal with its retry advice', async () => {
    fakeTurnstile();
    const user = userEvent.setup();
    client.requestPasswordReset.mockResolvedValue({
      error: {
        status: 403,
        code: 'HUMAN_CHECK',
        message:
          'The security check expired or did not pass. Try again: a new check runs on its own.',
      },
    });
    render(<ForgotPasswordForm email="asha@example.com" humanCheckKey="site" />);
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));
    expect(await screen.findByText(/Try again: a new check runs on its own/)).toBeInTheDocument();
    expect(client.requestPasswordReset.mock.calls[0]![0]).toMatchObject({
      fetchOptions: { headers: { 'x-turnstile-token': 'token-1' } },
    });
  });

  it('adds nothing to the page or the request when the check is off', async () => {
    const user = userEvent.setup();
    client.requestPasswordReset.mockResolvedValue({ error: null });
    render(<ForgotPasswordForm email="asha@example.com" />);
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }));
    await waitFor(() => expect(client.requestPasswordReset).toHaveBeenCalled());
    expect(client.requestPasswordReset.mock.calls.at(-1)![0]).toEqual({
      email: 'asha@example.com',
      redirectTo: '/reset-password',
    });
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });
});
