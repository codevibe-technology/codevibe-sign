import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { checkFieldValue, type FieldValue } from '@codevibe_technology/sign-core';
import { field, letterSource, recipient } from '../test/fixtures';
import { SigningView } from './SigningView';

const asha = recipient('r1', 'Asha Rao', 1);
const fields = [
  field('sig', 'signature', 'r1', { y: 600 }),
  field('ini', 'initials', 'r1', { y: 700, width: 60, height: 40 }, { required: false }),
  field('date', 'date_signed', 'r1', { y: 650 }),
  field('agree', 'checkbox', 'r1', { y: 100, width: 18, height: 18 }),
  field('city', 'text', 'r1', { y: 200 }),
  field('other', 'signature', 'r2', { y: 300 }),
];

function setup(overrides: Partial<Parameters<typeof SigningView>[0]> = {}) {
  const onSubmit = vi.fn<(values: FieldValue[]) => void>();
  const onDecline = vi.fn<(reason: string) => void>();
  render(
    <SigningView
      documents={[{ id: 'doc', source: letterSource(1) }]}
      fields={fields}
      recipient={asha}
      onSubmit={onSubmit}
      onDecline={onDecline}
      today={new Date(2026, 10, 19)}
      {...overrides}
    />,
  );
  return { onSubmit, onDecline };
}

async function signWithTypedName() {
  fireEvent.click(screen.getByRole('button', { name: 'Signature, required' }));
  const dialog = screen.getByRole('dialog', { name: 'Add your signature' });
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Type' }));
  expect(within(dialog).getByLabelText('Your name')).toHaveValue('Asha Rao');
  const apply = within(dialog).getByRole('button', { name: 'Apply' });
  await waitFor(() => expect(apply).toBeEnabled());
  fireEvent.click(apply);
}

describe('SigningView', () => {
  it("shows only the recipient's fields and fills the date", () => {
    setup();
    expect(screen.getAllByRole('button', { name: /^Signature/ })).toHaveLength(1);
    expect(screen.getByRole('note', { name: /Date signed/ })).toHaveAttribute(
      'data-state',
      'filled',
    );
    expect(screen.getByText('1 of 4 required fields done')).toBeInTheDocument();
  });

  it('blocks submit until required fields are filled and marks them invalid', () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('3 required fields still need you.');
    expect(screen.getByRole('button', { name: 'Signature, required' })).toHaveAttribute(
      'data-state',
      'invalid',
    );
    expect(screen.getByRole('textbox', { name: 'Text, required' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Checkbox, required' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Initials, optional' })).toHaveAttribute(
      'data-state',
      'empty',
    );
  });

  it('guides to the next required field in reading order', () => {
    setup();
    const next = screen.getByRole('button', { name: 'Next field' });
    fireEvent.click(next);
    expect(screen.getByRole('checkbox', { name: 'Checkbox, required' })).toHaveFocus();
    fireEvent.click(next);
    expect(screen.getByRole('textbox', { name: 'Text, required' })).toHaveFocus();
    fireEvent.click(next);
    expect(screen.getByRole('button', { name: 'Signature, required' })).toHaveFocus();
  });

  it('submits the values in reading order with the core shapes', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Checkbox, required' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Text, required' }), {
      target: { value: 'Pune' },
    });
    await signWithTypedName();
    expect(screen.getByRole('button', { name: 'Signature, required' })).toHaveAttribute(
      'data-state',
      'filled',
    );
    expect(screen.getByText('4 of 4 required fields done')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.map((v) => v.fieldId)).toEqual(['agree', 'city', 'sig', 'date']);
    expect(payload[0]).toEqual({ fieldId: 'agree', value: 'true' });
    expect(payload[1]).toEqual({ fieldId: 'city', value: 'Pune' });
    expect(payload[3]).toEqual({ fieldId: 'date', value: '2026-11-19' });
    expect(checkFieldValue('signature', payload[2]!.value).ok).toBe(true);
    for (const v of payload) expect(Object.keys(v).sort()).toEqual(['fieldId', 'value']);
  });

  it('reuses the adopted initials on the next initials field', async () => {
    setup({
      fields: [
        field('i1', 'initials', 'r1', { y: 100 }),
        field('i2', 'initials', 'r1', { y: 200 }),
      ],
    });
    const [first, second] = screen.getAllByRole('button', { name: 'Initials, required' });
    fireEvent.click(first!);
    const dialog = screen.getByRole('dialog', { name: 'Add your initials' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Type' }));
    expect(within(dialog).getByLabelText('Your name')).toHaveValue('AR');
    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);

    fireEvent.click(second!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(second).toHaveAttribute('data-state', 'filled');
  });

  it('closes the signature dialog on Escape without filling the field', () => {
    setup();
    const target = screen.getByRole('button', { name: 'Signature, required' });
    fireEvent.click(target);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(target).toHaveAttribute('data-state', 'empty');
  });

  it('asks for a reason before declining', async () => {
    const { onDecline, onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const dialog = screen.getByRole('dialog', { name: 'Decline to sign' });
    const confirm = within(dialog).getByRole('button', { name: 'Decline' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/why you are declining/), {
      target: { value: '  Wrong salary figure  ' },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(onDecline).toHaveBeenCalledWith('Wrong salary figure'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows why the server refused a submit or decline', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('Verify the one-time code first');
    });
    const onDecline = vi.fn(async () => {
      throw new Error('This link is no longer valid');
    });
    setup({ fields: [field('city', 'text', 'r1', { y: 200 })], onSubmit, onDecline });
    fireEvent.change(screen.getByRole('textbox', { name: 'Text, required' }), {
      target: { value: 'Pune' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Verify the one-time code first'),
    );
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const dialog = screen.getByRole('dialog', { name: 'Decline to sign' });
    fireEvent.change(within(dialog).getByLabelText(/why you are declining/), {
      target: { value: 'Wrong figure' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('This link is no longer valid'),
    );
  });

  it('accepts the recipient as the server sends it', () => {
    setup({ recipient: { id: 'r1', name: 'Asha Rao' } });
    expect(screen.getAllByRole('button', { name: /^Signature/ })).toHaveLength(1);
  });

  it('starts from saved values', () => {
    setup({ initialValues: [{ fieldId: 'city', value: 'Nagpur' }] });
    expect(screen.getByRole('textbox', { name: 'Text, required' })).toHaveValue('Nagpur');
  });
});
