// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  setWorkspaceTimeZoneAction: vi.fn(),
  renameWorkspaceAction: vi.fn(),
  updatePreferencesAction: vi.fn(),
}));
vi.mock('@/server/actions/workspace', () => actions);
vi.mock('@/server/actions/personal', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { WorkspaceTimeZoneForm } = await import('./workspace-time-zone-form');
const { PersonalForm } = await import('./personal-form');

const options = () =>
  within(screen.getByLabelText('Time zone'))
    .getAllByRole('option')
    .map((o) => (o as HTMLOptionElement).value);

describe('the first paint of a time zone form', () => {
  /** An `Intl` that words offsets the way another machine might: `UTC+05:30`. */
  function otherMachine() {
    const Real = Intl.DateTimeFormat;
    return vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
    ) {
      const real = new Real(...args);
      return {
        ...real,
        format: real.format.bind(real),
        resolvedOptions: real.resolvedOptions.bind(real),
        formatToParts: (date?: Date) =>
          real
            .formatToParts(date)
            .map((part) => (part.type === 'timeZoneName' ? { ...part, value: 'UTC+05:30' } : part)),
      } as Intl.DateTimeFormat;
    } as unknown as typeof Intl.DateTimeFormat);
  }

  it('is the same on the server and in the browser, however each words the offset', async () => {
    const form = <WorkspaceTimeZoneForm workspaceId="ws_1" timeZone="Asia/Kolkata" chosen />;
    const server = otherMachine();
    const html = renderToString(form);
    server.mockRestore();
    expect(html).toContain('Asia/Kolkata');
    expect(html).not.toMatch(/UTC\+05:30|GMT\+5:30/);

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const mismatches: unknown[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, form, { onRecoverableError: (e) => mismatches.push(e) });
    });
    expect(mismatches).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(within(container).getByTestId('zone-now')).toHaveTextContent(
      /dated in Asia\/Kolkata \(GMT\+5:30\)/,
    );
    await act(async () => root.unmount());
    container.remove();
  });
});

describe('WorkspaceTimeZoneForm', () => {
  it('shows the zone in use and says when it is only the default', () => {
    render(<WorkspaceTimeZoneForm workspaceId="ws_1" timeZone="Asia/Kolkata" chosen={false} />);
    expect((screen.getByLabelText('Time zone') as HTMLSelectElement).value).toBe('Asia/Kolkata');
    expect(screen.getByText(/default here until you save one/)).toBeTruthy();
    expect(screen.getByTestId('zone-now')).toHaveTextContent(
      /dated in Asia\/Kolkata \(GMT\+5:30\)/,
    );
    expect(screen.getByRole('button', { name: 'Save time zone' })).toBeEnabled();
  });

  it('narrows the full list as you type and saves the pick', async () => {
    const user = userEvent.setup();
    actions.setWorkspaceTimeZoneAction.mockResolvedValue({
      ok: true,
      data: { timeZone: 'Pacific/Auckland' },
    });
    render(<WorkspaceTimeZoneForm workspaceId="ws_1" timeZone="Asia/Kolkata" chosen />);
    expect(options().length).toBeGreaterThan(300);
    expect(screen.getByRole('button', { name: 'Save time zone' })).toBeDisabled();

    await user.type(screen.getByLabelText('Search time zones'), 'auck');
    expect(options()).toEqual(['Asia/Kolkata', 'Pacific/Auckland']);
    expect(screen.getByRole('status')).toHaveTextContent('1 time zone found');
    await user.selectOptions(screen.getByLabelText('Time zone'), 'Pacific/Auckland');
    await user.click(screen.getByRole('button', { name: 'Save time zone' }));

    expect(actions.setWorkspaceTimeZoneAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      timeZone: 'Pacific/Auckland',
    });
    expect(await screen.findByText(/dated in Pacific\/Auckland/)).toBeTruthy();
  });

  it('puts a refusal next to the field', async () => {
    const user = userEvent.setup();
    actions.setWorkspaceTimeZoneAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'Pick a time zone from the list',
      field: 'timeZone',
    });
    render(<WorkspaceTimeZoneForm workspaceId="ws_1" timeZone="UTC" chosen={false} />);
    await user.click(screen.getByRole('button', { name: 'Save time zone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a time zone from the list');
  });
});

describe('PersonalForm', () => {
  const user = { name: 'Asha', email: 'asha@example.com' };

  it('follows the device until a zone is picked', async () => {
    const pointer = userEvent.setup();
    actions.updatePreferencesAction.mockResolvedValue({ ok: true, data: {} });
    render(
      <PersonalForm user={user} preferences={{ theme: 'system', timezone: null, locale: 'en' }} />,
    );
    const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getByRole('option', { name: 'Match my device' })).toBeTruthy();
    await pointer.selectOptions(select, 'America/New_York');
    await pointer.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(actions.updatePreferencesAction).toHaveBeenCalledWith({
      theme: 'system',
      timezone: 'America/New_York',
    });
  });
});
