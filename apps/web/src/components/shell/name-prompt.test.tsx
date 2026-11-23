// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ updateNameAction: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/server/actions/personal', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast }));

const { NamePrompt, NAME_PROMPT_KEY } = await import('./name-prompt');

const prompt = () => screen.queryByRole('region', { name: 'Add your name' });

beforeEach(() => {
  window.sessionStorage.clear();
  actions.updateNameAction.mockReset();
  router.refresh.mockReset();
  toast.success.mockReset();
});

describe('NamePrompt', () => {
  it('saves the name from the banner and gets out of the way', async () => {
    const user = userEvent.setup();
    actions.updateNameAction.mockResolvedValue({ ok: true, data: { name: 'Ravi Kumar' } });
    render(<NamePrompt />);
    expect(prompt()).not.toBeNull();
    await user.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(actions.updateNameAction).toHaveBeenCalledWith({ name: 'Ravi Kumar' });
    await waitFor(() => expect(prompt()).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Your name is saved');
    expect(router.refresh).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(NAME_PROMPT_KEY)).toBeNull();
  });

  it('checks the name before sending it and shows a refusal from the server', async () => {
    const user = userEvent.setup();
    render(<NamePrompt />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
    expect(actions.updateNameAction).not.toHaveBeenCalled();

    actions.updateNameAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'A name needs at least one letter',
      field: 'name',
    });
    await user.type(screen.getByLabelText('Your name'), 'Ravi');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one letter');
    expect(prompt()).not.toBeNull();
  });

  it('stays closed for the session after "Not now" and returns in the next one', async () => {
    const user = userEvent.setup();
    const first = render(<NamePrompt />);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(prompt()).toBeNull();
    expect(window.sessionStorage.getItem(NAME_PROMPT_KEY)).toBe('1');
    expect(actions.updateNameAction).not.toHaveBeenCalled();
    first.unmount();

    const again = render(<NamePrompt />);
    expect(prompt()).toBeNull();
    again.unmount();

    window.sessionStorage.clear();
    render(<NamePrompt />);
    expect(prompt()).not.toBeNull();
  });

  it.each([
    ['open', false],
    ['dismissed', true],
  ])('hydrates without a mismatch when the session has it %s', async (_label, dismissed) => {
    const html = renderToString(<NamePrompt />);
    expect(html).toBe('');
    if (dismissed) window.sessionStorage.setItem(NAME_PROMPT_KEY, '1');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, <NamePrompt />, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector('section') === null).toBe(dismissed);
    container.remove();
  });
});
