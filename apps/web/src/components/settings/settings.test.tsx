// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
  inviteMemberAction: vi.fn(),
  changeRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));
vi.mock('@/server/actions/api-keys', () => actions);
vi.mock('@/server/actions/team', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiKeysPanel } = await import('./api-keys-panel');
const { TeamPanel } = await import('./team-panel');
const { BrandPreview } = await import('./brand-preview');

describe('ApiKeysPanel', () => {
  it('starts with an empty state that explains keys', () => {
    render(<ApiKeysPanel workspaceId="ws_1" apiUrl="https://x/api/v1" keys={[]} />);
    expect(screen.getByText('No API keys yet')).toBeTruthy();
  });

  it('shows a new key once, then never again', async () => {
    const user = userEvent.setup();
    actions.createApiKeyAction.mockResolvedValue({
      ok: true,
      data: { key: 'cvs_secret', prefix: 'cvs_secre' },
    });
    render(<ApiKeysPanel workspaceId="ws_1" apiUrl="https://x/api/v1" keys={[]} />);
    await user.click(screen.getByRole('button', { name: 'New API key' }));
    await user.type(screen.getByLabelText('Name'), 'HR system');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(actions.createApiKeyAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      name: 'HR system',
    });
    expect((await screen.findByTestId('new-key')).textContent).toBe('cvs_secret');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('cvs_secret')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New API key' }));
    expect(screen.queryByText('cvs_secret')).toBeNull();
  });

  it('puts a refused name next to the field', async () => {
    const user = userEvent.setup();
    actions.createApiKeyAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'Name the key',
      field: 'name',
    });
    render(<ApiKeysPanel workspaceId="ws_1" apiUrl="https://x/api/v1" keys={[]} />);
    await user.click(screen.getByRole('button', { name: 'New API key' }));
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name the key');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('lists keys by name and prefix only', () => {
    render(
      <ApiKeysPanel
        workspaceId="ws_1"
        apiUrl="https://x/api/v1"
        keys={[
          {
            id: 'key_1',
            name: 'CI',
            prefix: 'cvs_abcdef',
            createdAt: '2026-11-01T00:00:00Z',
            createdByName: 'Asha',
            lastUsedAt: null,
          },
        ]}
      />,
    );
    expect(screen.getByText('CI')).toBeTruthy();
    expect(screen.getByText(/cvs_abcdef…/)).toBeTruthy();
    expect(screen.getByText(/last used Never/)).toBeTruthy();
  });
});

describe('TeamPanel', () => {
  const members = [
    { userId: 'u0', name: 'Olu Owner', email: 'olu@x.co', role: 'owner' as const },
    { userId: 'u1', name: 'Asha Admin', email: 'asha@x.co', role: 'admin' as const },
    { userId: 'u2', name: 'Mia Member', email: 'mia@x.co', role: 'member' as const },
  ];

  it('lets an admin manage members but not owners or themselves', () => {
    render(
      <TeamPanel
        workspaceId="ws_1"
        currentUserId="u1"
        actorRole="admin"
        members={members}
        invitations={[]}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).queryByRole('combobox')).toBeNull();
    expect(within(rows[1]!).queryByRole('combobox')).toBeNull();
    const mia = within(rows[2]!).getByRole('combobox', { name: /Role of Mia/ });
    expect([...(mia as HTMLSelectElement).options].map((o) => o.value)).not.toContain('owner');
    const invite = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...invite.options].map((o) => o.value)).toEqual(['admin', 'member', 'viewer']);
  });

  it('lets an owner make owners', () => {
    render(
      <TeamPanel
        workspaceId="ws_1"
        currentUserId="u0"
        actorRole="owner"
        members={members}
        invitations={[]}
      />,
    );
    const invite = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...invite.options].map((o) => o.value)).toContain('owner');
  });

  it('sends an invitation with the chosen role', async () => {
    const user = userEvent.setup();
    actions.inviteMemberAction.mockResolvedValue({ ok: true, data: { email: 'new@x.co' } });
    render(
      <TeamPanel
        workspaceId="ws_1"
        currentUserId="u1"
        actorRole="admin"
        members={members}
        invitations={[]}
      />,
    );
    await user.type(screen.getByLabelText('Email'), 'new@x.co');
    await user.selectOptions(screen.getByLabelText('Role'), 'viewer');
    await user.click(screen.getByRole('button', { name: /Send invite/ }));
    expect(actions.inviteMemberAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      email: 'new@x.co',
      role: 'viewer',
    });
  });

  it('carries the name the inviter typed and lists it while the invitation is open', async () => {
    const user = userEvent.setup();
    actions.inviteMemberAction.mockResolvedValue({ ok: true, data: { email: 'ravi@x.co' } });
    render(
      <TeamPanel
        workspaceId="ws_1"
        currentUserId="u1"
        actorRole="admin"
        members={members}
        invitations={[
          {
            id: 'inv_1',
            email: 'zoe@x.co',
            name: 'Zoe Zhang',
            role: 'member',
            expiresAt: '2026-12-01T00:00:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.getByText('Zoe Zhang')).toBeTruthy();
    await user.type(screen.getByLabelText('Email'), 'ravi@x.co');
    await user.type(screen.getByLabelText('Name (optional)'), 'Ravi Kumar');
    await user.click(screen.getByRole('button', { name: /Send invite/ }));
    expect(actions.inviteMemberAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      email: 'ravi@x.co',
      name: 'Ravi Kumar',
      role: 'member',
    });
  });

  it('calls a member with no name by their email address', () => {
    render(
      <TeamPanel
        workspaceId="ws_1"
        currentUserId="u0"
        actorRole="owner"
        members={[...members, { userId: 'u3', name: ' ', email: 'ravi@x.co', role: 'member' }]}
        invitations={[]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Role of ravi@x.co' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove ravi@x.co' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Mia Member' })).toBeTruthy();
  });
});

describe('BrandPreview', () => {
  it('draws the header in the brand colour with readable text', () => {
    const { rerender } = render(
      <BrandPreview
        logoUrl={null}
        brandColor="#0D1B2A"
        font="inter"
        senderName=""
        workspaceName="Acme"
      />,
    );
    const header = screen.getByTestId('preview-header');
    expect(header.style.background).toBe('rgb(13, 27, 42)');
    expect(header.style.color).toBe('rgb(255, 255, 255)');
    expect(header).toHaveTextContent('Acme');
    rerender(
      <BrandPreview
        logoUrl="/logo.png"
        brandColor="#2DD4BF"
        font="serif"
        senderName="Acme HR"
        workspaceName="Acme"
      />,
    );
    expect(screen.getByTestId('preview-header').style.color).toBe('rgb(13, 27, 42)');
    expect(screen.getByRole('img', { name: 'Acme logo' })).toHaveAttribute('src', '/logo.png');
    expect(screen.getByTestId('preview-header')).toHaveTextContent('Acme HR');
    expect(screen.getByText(/A square logo is a mark/)).toBeTruthy();
  });

  it('shows a wide logo on its own, as the signing page will', () => {
    render(
      <BrandPreview
        logoUrl="/wide.png"
        logoWide
        brandColor="#0D1B2A"
        font="inter"
        senderName="Acme HR"
        workspaceName="Acme"
      />,
    );
    const header = screen.getByTestId('preview-header');
    expect(screen.getByRole('img', { name: 'Acme logo' })).toHaveAttribute('data-shape', 'wide');
    expect(header).not.toHaveTextContent('Acme HR');
    expect(screen.getByText(/A wide logo already shows your name/)).toBeTruthy();
  });
});
