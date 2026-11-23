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
    render(<CreateWorkspaceForm host="sign.codevibe.in" />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    const address = screen.getByLabelText('Workspace address');
    expect(address).toHaveValue('acme-hr');
    expect(screen.getAllByText(/\/dashboard\//).length).toBeGreaterThan(0);
    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(mocks.requests.at(-1)).toBe('?slug=acme-hr');
  });

  it('says when the address is taken and fills in a free one', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Codevibe');
    expect(await screen.findByText('This address is taken. Try codevibe-2.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(mocks.createWorkspaceAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'codevibe-2' }));
    expect(screen.getByLabelText('Workspace address')).toHaveValue('codevibe-2');
    expect(await screen.findByText('Available')).toBeInTheDocument();
  });

  it('stops following the name once the address is edited', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" />);
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
    render(<CreateWorkspaceForm host="sign.codevibe.in" />);
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
    render(<CreateWorkspaceForm host="sign.codevibe.in" />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme HR');
    await screen.findByText('Available');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(mocks.createWorkspaceAction).toHaveBeenCalledWith({ name: 'Acme HR', slug: 'acme-hr' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone just took this address.');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard/acme-hr'));
  });

  it('writes an Indian-script name in Latin letters', async () => {
    render(<CreateWorkspaceForm host="sign.codevibe.in" />);
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
