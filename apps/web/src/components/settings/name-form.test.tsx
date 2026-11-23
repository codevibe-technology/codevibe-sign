// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ updateNameAction: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/server/actions/personal', () => actions);
vi.mock('sonner', () => ({ toast }));

const { NameForm } = await import('./name-form');

const asha = { name: 'Asha Rao', email: 'asha@example.com' };

beforeEach(() => {
  actions.updateNameAction.mockReset();
  toast.success.mockReset();
});

describe('NameForm', () => {
  it('shows the saved name and saves a change with a toast', async () => {
    const user = userEvent.setup();
    actions.updateNameAction.mockResolvedValue({ ok: true, data: { name: 'Asha R. Rao' } });
    render(<NameForm user={asha} />);
    const field = screen.getByLabelText('Your name');
    expect(field).toHaveValue('Asha Rao');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, 'Asha  R. Rao');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(actions.updateNameAction).toHaveBeenCalledWith({ name: 'Asha  R. Rao' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Your name is saved'));
    expect(field).toHaveValue('Asha R. Rao');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
  });

  it('starts empty for someone with no name and checks before sending', async () => {
    const user = userEvent.setup();
    render(<NameForm user={{ name: '', email: 'ravi@example.com' }} />);
    const field = screen.getByLabelText('Your name');
    expect(field).toHaveValue('');
    await user.type(field, 'R');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 2 characters');
    expect(actions.updateNameAction).not.toHaveBeenCalled();
  });

  it('puts a refusal from the server next to the field', async () => {
    const user = userEvent.setup();
    actions.updateNameAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'A name needs at least one letter',
      field: 'name',
    });
    render(<NameForm user={asha} />);
    await user.type(screen.getByLabelText('Your name'), ' Jr');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one letter');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('renders a name as text, never as markup', () => {
    const { container } = render(
      <NameForm user={{ name: '<img src=x onerror=alert(1)>', email: 'x@example.com' }} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Your name')).toHaveValue('<img src=x onerror=alert(1)>');
  });
});
