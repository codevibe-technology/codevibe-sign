// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/dashboard/acme' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/actions/personal', () => ({
  updatePreferencesAction: vi.fn(),
  updateNameAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

const { Sidebar } = await import('./sidebar');
const { AppShell } = await import('./app-shell');

const acme = { id: 'ws_1', slug: 'acme', name: 'Acme HR' };
const legal = { id: 'ws_2', slug: 'legal', name: 'Acme Legal' };
const asha = { name: 'Asha Rao', email: 'asha@example.com' };

beforeEach(() => {
  nav.pathname = '/dashboard/acme';
});

describe('Sidebar', () => {
  it('links the sections of the current workspace', () => {
    render(<Sidebar current={acme} workspaces={[acme]} canCreate user={asha} />);
    const links = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Dashboard', '/dashboard/acme'],
      ['Envelopes', '/dashboard/acme/envelopes'],
      ['Templates', '/dashboard/acme/templates'],
      ['Verify', '/dashboard/acme/verify'],
      ['Settings', '/dashboard/acme/settings'],
    ]);
  });

  it('marks only the section being viewed', () => {
    nav.pathname = '/dashboard/acme/settings/brand';
    render(<Sidebar current={acme} workspaces={[acme]} canCreate user={asha} />);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('switches workspaces and offers a new one when allowed', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <Sidebar current={acme} workspaces={[acme, legal]} canCreate user={asha} />,
    );
    await user.click(screen.getByRole('button', { name: /Switch workspace/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Acme Legal/ })).toHaveAttribute(
      'href',
      '/dashboard/legal',
    );
    expect(within(menu).getByRole('menuitem', { name: /New workspace/ })).toHaveAttribute(
      'href',
      '/onboarding',
    );
    unmount();

    render(<Sidebar current={acme} workspaces={[acme]} canCreate={false} user={asha} />);
    await user.click(screen.getByRole('button', { name: /Switch workspace/ }));
    expect(within(await screen.findByRole('menu')).queryByText(/New workspace/)).toBeNull();
  });

  it('keeps the docs link and the account menu at the foot of the rail', () => {
    render(<Sidebar current={acme} workspaces={[acme]} canCreate user={asha} />);
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('A');
  });

  it('opens the docs in a new tab and says so, so the app stays where it was', () => {
    render(<Sidebar current={acme} workspaces={[acme]} canCreate user={asha} />);
    const docs = screen.getByRole('link', { name: 'Docs (opens in a new tab)' });
    expect(docs).toHaveAttribute('href', '/docs');
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
    expect(docs.querySelector('svg.lucide-external-link')).toHaveAttribute('aria-hidden', 'true');
    for (const link of within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole(
      'link',
    )) {
      expect(link).not.toHaveAttribute('target');
    }
  });

  it('shows a workspace’s logo in its tile, and its initials when it has none', async () => {
    const user = userEvent.setup();
    const branded = { ...acme, logoUrl: '/brand/ws_1/logo?v=1700000000000' };
    render(<Sidebar current={branded} workspaces={[branded, legal]} canCreate user={asha} />);
    const trigger = screen.getByRole('button', { name: /Switch workspace/ });
    const logo = within(trigger).getByRole('img', { name: 'Acme HR' });
    expect(logo).toHaveAttribute('src', '/brand/ws_1/logo?v=1700000000000');
    expect(logo).toHaveAttribute('width', '32');
    expect(logo).toHaveAttribute('height', '32');
    expect(logo.className).toMatch(/\bh-8 w-8\b.*\bobject-contain\b/);
    expect(within(trigger).queryByText('AH')).toBeNull();

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    const own = within(menu).getByRole('menuitem', { name: /Acme HR/ });
    expect(within(own).getByRole('img', { name: 'Acme HR' })).toHaveAttribute(
      'src',
      branded.logoUrl,
    );
    const other = within(menu).getByRole('menuitem', { name: /Acme Legal/ });
    expect(within(other).queryByRole('img')).toBeNull();
    expect(within(other).getByText('AL')).toBeInTheDocument();
  });

  it('falls back to initials in a tile of the same size when the logo cannot load', () => {
    const branded = { ...acme, logoUrl: '/brand/ws_1/logo?v=1' };
    const { rerender } = render(
      <Sidebar current={branded} workspaces={[branded]} canCreate user={asha} />,
    );
    const trigger = screen.getByRole('button', { name: /Switch workspace/ });
    fireEvent.error(within(trigger).getByRole('img'));
    expect(within(trigger).queryByRole('img')).toBeNull();
    expect(within(trigger).getByText('AH').className).toMatch(/\bh-8 w-8\b/);

    const replaced = { ...acme, logoUrl: '/brand/ws_1/logo?v=2' };
    rerender(<Sidebar current={replaced} workspaces={[replaced]} canCreate user={asha} />);
    expect(within(trigger).getByRole('img')).toHaveAttribute('src', '/brand/ws_1/logo?v=2');
  });
});

describe('AppShell', () => {
  it('shows the workspace, the account menu and the page, with a skip target', () => {
    render(
      <AppShell user={asha} sidebar={{ current: acme, workspaces: [acme], canCreate: true }}>
        <p>Page body</p>
      </AppShell>,
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByText('Page body')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  it('opens the navigation drawer on small screens', async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        user={{ name: '', email: 'asha@example.com' }}
        sidebar={{ current: acme, workspaces: [acme], canCreate: true }}
      >
        <p>Body</p>
      </AppShell>,
    );
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).getByRole('link', { name: 'Templates' })).toBeTruthy();
  });

  it('asks a member with no name to add one, and nobody else', async () => {
    window.sessionStorage.clear();
    const shell = (name: string) => (
      <AppShell
        user={{ name, email: 'ravi@example.com' }}
        sidebar={{ current: acme, workspaces: [acme], canCreate: true }}
      >
        <p>Body</p>
      </AppShell>
    );
    const { unmount } = render(shell(' '));
    const prompt = await screen.findByRole('region', { name: 'Add your name' });
    expect(within(screen.getByRole('main')).getByText('Body')).toBeTruthy();
    expect(prompt.compareDocumentPosition(screen.getByText('Body'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('R');
    unmount();

    render(shell('Ravi Kumar'));
    expect(screen.queryByRole('region', { name: 'Add your name' })).toBeNull();
  });
});
