// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createWorkspaceAction: vi.fn(),
  changeWorkspaceAddressAction: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  taken: new Set<string>(),
  requests: [] as string[],
}));
vi.mock('@/server/actions/workspace', () => ({
  createWorkspaceAction: mocks.createWorkspaceAction,
  changeWorkspaceAddressAction: mocks.changeWorkspaceAddressAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => '/dashboard/acme/settings/workspace',
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const { CreateWorkspaceForm } = await import('@/app/onboarding/create-workspace-form');
const { ChangeAddressDialog } = await import('@/components/settings/change-address-dialog');

beforeEach(() => {
  mocks.taken = new Set(['codevibe']);
  mocks.requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      mocks.requests.push(url.search);
      const slug = url.searchParams.get('slug') ?? '';
      const data = mocks.taken.has(slug)
        ? {
            status: 'taken',
            message: 'This address is taken. Try codevibe-2.',
            suggestions: ['codevibe-2', 'codevibe-3'],
          }
        : { status: 'available', message: 'Available', suggestions: [] };
      return new Response(JSON.stringify({ ok: true, data }), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

describe('CreateWorkspaceForm', () => {
  it('suggests the address from the name behind a fixed prefix', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    const address = screen.getByLabelText('Workspace address');
    expect(address).toHaveValue('acme-hr');
    expect(screen.getAllByText(/\/dashboard\//).length).toBeGreaterThan(0);
    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(mocks.requests.at(-1)).toBe('?slug=acme-hr');
  });

  it('says when the address is taken and fills in a free one', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Codevibe');
    expect(await screen.findByText('This address is taken. Try codevibe-2.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(mocks.createWorkspaceAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'codevibe-2' }));
    expect(screen.getByLabelText('Workspace address')).toHaveValue('codevibe-2');
    expect(await screen.findByText('Available')).toBeInTheDocument();
  });

  it('stops following the name once the address is edited', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    const name = screen.getByLabelText('Workspace name');
    const address = screen.getByLabelText('Workspace address');
    await userEvent.type(name, 'Acme');
    await userEvent.clear(address);
    await userEvent.type(address, 'Acme Legal Team');
    expect(address).toHaveValue('acme-legal-team');
    await userEvent.type(name, ' Group');
    expect(address).toHaveValue('acme-legal-team');
  });

  it('shows format problems at once, without asking the server', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    await userEvent.type(screen.getByLabelText('Workspace address'), 'ab');
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 3 characters.');
    expect(mocks.requests).toEqual([]);
  });

  it('sends the name and the address and shows the server error on the address', async () => {
    mocks.createWorkspaceAction.mockResolvedValueOnce({
      ok: false,
      code: 'CONFLICT',
      error: 'Someone just took this address. Try another one.',
      field: 'slug',
    });
    mocks.createWorkspaceAction.mockResolvedValueOnce({ ok: true, data: { slug: 'acme-hr' } });
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    await screen.findByText('Available');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(mocks.createWorkspaceAction).toHaveBeenCalledWith({ name: 'Acme HR', slug: 'acme-hr' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone just took this address.');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard/acme-hr'));
  });

  it('asks someone with no name for it first, and sends it with the workspace', async () => {
    mocks.createWorkspaceAction.mockResolvedValueOnce({ ok: true, data: { slug: 'acme-hr' } });
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" askName />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    await screen.findByText('Available');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
    expect(mocks.createWorkspaceAction).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Your name'), 'José Álvarez');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(mocks.createWorkspaceAction).toHaveBeenCalledWith({
      name: 'Acme HR',
      slug: 'acme-hr',
      yourName: 'José Álvarez',
    });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard/acme-hr'));
  });

  it('does not ask someone who already has a name', () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('shows the server’s word on the person’s name next to that field', async () => {
    mocks.createWorkspaceAction.mockResolvedValueOnce({
      ok: false,
      code: 'VALIDATION',
      error: 'A name needs at least one letter',
      field: 'yourName',
    });
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" askName />);
    await userEvent.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    await screen.findByText('Available');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one letter');
  });

  it('asks someone with only email links for a password, typed twice, with a meter', async () => {
    mocks.createWorkspaceAction.mockResolvedValueOnce({ ok: true, data: { slug: 'acme-hr' } });
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" askPassword />);
    expect(screen.getByText(/even when email links are slow/)).toBeVisible();
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    await screen.findByText('Available');

    const password = screen.getByLabelText('Password');
    await userEvent.type(password, 'asha2026');
    expect(screen.getByText('Too weak')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 10 characters');
    expect(mocks.createWorkspaceAction).not.toHaveBeenCalled();

    await userEvent.clear(password);
    await userEvent.type(password, 'seven quiet copper kettles');
    expect(screen.getByText('Strong')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Confirm password'), 'seven quiet copper kettle');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(mocks.createWorkspaceAction).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Confirm password'), 's');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(mocks.createWorkspaceAction).toHaveBeenCalledWith({
      name: 'Acme HR',
      slug: 'acme-hr',
      password: 'seven quiet copper kettles',
    });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard/acme-hr'));
  });

  it('shows the server’s word on the password next to that field', async () => {
    mocks.createWorkspaceAction.mockResolvedValueOnce({
      ok: false,
      code: 'VALIDATION',
      error: 'Do not build the password from your email address or name.',
      field: 'password',
    });
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" askPassword />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    await screen.findByText('Available');
    await userEvent.type(screen.getByLabelText('Password'), 'mango river lantern');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'mango river lantern');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('email address or name');
  });

  it('asks no password of someone who has a way in already', () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('writes an Indian-script name in Latin letters', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" email="asha@example.com" />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'भारत');
    expect(screen.getByLabelText('Workspace address')).toHaveValue('bharat');
  });
});

describe('ChangeAddressDialog', () => {
  const workspace = { id: 'ws_1', slug: 'acme' };

  it('explains what changes, checks as it is typed, and moves to the new address', async () => {
    mocks.changeWorkspaceAddressAction.mockResolvedValue({
      ok: true,
      data: { slug: 'acme-legal' },
    });
    render(<ChangeAddressDialog workspace={workspace} host="sign.codevibe.in" />);
    await userEvent.click(screen.getByRole('button', { name: 'Change address' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Links in emails already sent keep working.')).toBeVisible();
    expect(within(dialog).getByText(/redirect here/)).toBeVisible();
    const confirm = within(dialog).getByRole('button', { name: 'Change address' });
    expect(confirm).toBeDisabled();
    const input = within(dialog).getByLabelText('New address');
    await userEvent.clear(input);
    await userEvent.type(input, 'acme-legal');
    expect(await within(dialog).findByText('Available')).toBeInTheDocument();
    expect(mocks.requests.at(-1)).toBe('?slug=acme-legal&workspace=ws_1');
    await userEvent.click(confirm);
    expect(mocks.changeWorkspaceAddressAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      slug: 'acme-legal',
    });
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/dashboard/acme-legal/settings/workspace'),
    );
  });

  it('will not confirm a taken address', async () => {
    render(<ChangeAddressDialog workspace={workspace} host="sign.codevibe.in" />);
    await userEvent.click(screen.getByRole('button', { name: 'Change address' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('New address');
    await userEvent.clear(input);
    await userEvent.type(input, 'codevibe');
    expect(await within(dialog).findByText(/This address is taken/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Change address' })).toBeDisabled();
    expect(mocks.changeWorkspaceAddressAction).not.toHaveBeenCalled();
  });
});
