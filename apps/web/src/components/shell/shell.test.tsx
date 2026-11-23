// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/dashboard/acme' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/actions/personal', () => ({ updatePreferencesAction: vi.fn() }));
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
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('A');
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
});
