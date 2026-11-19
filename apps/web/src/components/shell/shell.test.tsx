// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/w/acme' }));
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

beforeEach(() => {
  nav.pathname = '/w/acme';
});

describe('Sidebar', () => {
  it('links the sections of the current workspace', () => {
    render(<Sidebar current={acme} workspaces={[acme]} canCreate />);
    const links = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Dashboard', '/w/acme'],
      ['Envelopes', '/w/acme/envelopes'],
      ['Templates', '/w/acme/templates'],
      ['Verify', '/w/acme/verify'],
      ['Settings', '/w/acme/settings'],
    ]);
  });

  it('marks only the section being viewed', () => {
    nav.pathname = '/w/acme/settings/brand';
    render(<Sidebar current={acme} workspaces={[acme]} canCreate />);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('switches workspaces and offers a new one when allowed', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Sidebar current={acme} workspaces={[acme, legal]} canCreate />);
    await user.click(screen.getByRole('button', { name: /Switch workspace/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Acme Legal/ })).toHaveAttribute(
      'href',
      '/w/legal',
    );
    expect(within(menu).getByRole('menuitem', { name: /New workspace/ })).toHaveAttribute(
      'href',
      '/onboarding',
    );
    unmount();

    render(<Sidebar current={acme} workspaces={[acme]} canCreate={false} />);
    await user.click(screen.getByRole('button', { name: /Switch workspace/ }));
    expect(within(await screen.findByRole('menu')).queryByText(/New workspace/)).toBeNull();
  });
});

describe('AppShell', () => {
  it('shows the workspace, the account menu and the page, with a skip target', () => {
    render(
      <AppShell
        user={{ name: 'Asha Rao', email: 'asha@example.com' }}
        sidebar={{ current: acme, workspaces: [acme], canCreate: true }}
      >
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
