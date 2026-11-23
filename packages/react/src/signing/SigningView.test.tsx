import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { checkFieldValue, type FieldValue } from '@codevibe_technology/sign-core';
import { fakePng, field, letterSource, recipient } from '../test/fixtures';
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

  it('guides from Start through each required field in reading order', () => {
    setup();
    const bar = screen.getByRole('group', { name: 'Signing progress and actions' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Start' }));
    const agree = screen.getByRole('checkbox', { name: 'Checkbox, required' });
    expect(agree).toHaveFocus();
    expect(agree.closest('.cvs-field')).toHaveAttribute('data-current', 'true');
    expect(document.querySelector('.cvs-guide-flag')).toHaveTextContent('Tick here');

    fireEvent.click(within(bar).getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('textbox', { name: 'Text, required' })).toHaveFocus();
    expect(document.querySelector('.cvs-guide-flag')).toHaveTextContent('Fill in');

    fireEvent.click(within(bar).getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Signature, required' })).toHaveFocus();
    expect(document.querySelector('.cvs-guide-flag')).toHaveTextContent('Sign here');
  });

  it('turns the guide button into Sign on a signature box, then moves on by itself', async () => {
    setup({
      fields: [
        field('sig', 'signature', 'r1', { y: 100 }),
        field('city', 'text', 'r1', { y: 300 }),
      ],
    });
    const bar = screen.getByRole('group', { name: 'Signing progress and actions' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Start' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Sign' }));
    const dialog = screen.getByRole('dialog', { name: 'Add your signature' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Type' }));
    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);

    const city = screen.getByRole('textbox', { name: 'Text, required' });
    await waitFor(() => expect(city).toHaveFocus());
    expect(within(bar).getByRole('button', { name: 'Next' })).toBeInTheDocument();

    // Enter in the last field hands over to Finish, now the main button.
    fireEvent.change(city, { target: { value: 'Pune' } });
    fireEvent.keyDown(city, { key: 'Enter' });
    const finish = within(bar).getByRole('button', { name: 'Finish' });
    await waitFor(() => expect(finish).toHaveFocus());
    expect(finish).toHaveClass('cvs-button--primary');
    expect(within(bar).queryByRole('button', { name: /^(Start|Next|Sign)$/ })).toBeNull();
    expect(document.querySelector('.cvs-guide-flag')).toBeNull();
  });

  it('keeps Finish secondary while fields are left, and offers optional ones after', async () => {
    setup({
      fields: [
        field('agree', 'checkbox', 'r1', { y: 100, width: 18, height: 18 }),
        field('note', 'text', 'r1', { y: 300 }, { required: false }),
      ],
    });
    expect(screen.getByRole('button', { name: 'Finish' })).not.toHaveClass('cvs-button--primary');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Checkbox, required' }));
    expect(screen.getByRole('button', { name: 'Finish' })).toHaveClass('cvs-button--primary');
    fireEvent.click(screen.getByRole('button', { name: 'Next field' }));
    expect(screen.getByRole('textbox', { name: 'Text, optional' })).toHaveFocus();
  });

  it('names the scrolling pages and announces progress', () => {
    setup();
    expect(screen.getByRole('region', { name: 'Document pages' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('1 of 4 required fields done')).toHaveAttribute('aria-live', 'polite');
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

describe('SigningView with many signature boxes', () => {
  const many = [
    field('s1', 'signature', 'r1', { y: 100 }),
    field('s2', 'signature', 'r1', { y: 300 }),
    field('i1', 'initials', 'r1', { y: 500, width: 60, height: 40 }),
    field('i2', 'initials', 'r1', { y: 560, width: 60, height: 40 }),
    field('i3', 'initials', 'r1', { y: 620, width: 60, height: 40 }),
  ];

  async function adopt(name: string, title: string) {
    fireEvent.click(screen.getAllByRole('button', { name })[0]!);
    const dialog = screen.getByRole('dialog', { name: title });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Type' }));
    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
  }

  it('asks for the signature once, then fills each other box with one tap', async () => {
    setup({ fields: many });
    await adopt('Signature, required', 'Add your signature');
    const second = screen.getAllByRole('button', { name: 'Signature, required' })[1]!;
    expect(second).toHaveAttribute('data-state', 'empty');
    fireEvent.click(second);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(second).toHaveAttribute('data-state', 'filled');
  });

  it('fills every empty initials box at once after adopting initials', async () => {
    setup({ fields: many });
    fireEvent.click(screen.getByRole('button', { name: 'Fill all my initials (3)' }));
    const dialog = screen.getByRole('dialog', { name: 'Add your initials' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Type' }));
    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    for (const box of screen.getAllByRole('button', { name: 'Initials, required' })) {
      expect(box).toHaveAttribute('data-state', 'filled');
    }
    expect(screen.queryByRole('button', { name: /Fill all my initials/ })).toBeNull();
  });

  it('offers no bulk fill with a single initials box', () => {
    setup({ fields: [field('i1', 'initials', 'r1')] });
    expect(screen.queryByRole('button', { name: /Fill all my initials/ })).toBeNull();
  });

  it('replaces the adopted signature everywhere when it is redone', async () => {
    // Both boxes carry the signature adopted on an earlier visit.
    const saved = `data:image/png;base64,${fakePng()}`;
    setup({
      fields: many,
      initialValues: [
        { fieldId: 's1', value: fakePng() },
        { fieldId: 's2', value: fakePng() },
      ],
    });
    const [first, second] = screen.getAllByRole('button', { name: 'Signature, required' });
    const image = (box: HTMLElement) => box.querySelector('img')!.getAttribute('src');
    expect(image(first!)).toBe(saved);
    expect(image(second!)).toBe(saved);

    fireEvent.click(first!);
    const dialog = screen.getByRole('dialog', { name: 'Add your signature' });
    expect(
      within(dialog).getByText('Your other signature boxes take this signature with one tap.'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Type' }));
    fireEvent.change(within(dialog).getByLabelText('Your name'), { target: { value: 'A. Rao' } });
    // Apply is live from the start here, so wait for the typed signature to be drawn.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    expect(image(first!)).not.toBe(saved);
    expect(image(second!)).toBe(image(first!));
  });

  it('adopts a signature saved on an earlier visit', () => {
    setup({ fields: many, initialValues: [{ fieldId: 's1', value: fakePng() }] });
    const second = screen.getAllByRole('button', { name: 'Signature, required' })[1]!;
    fireEvent.click(second);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(second).toHaveAttribute('data-state', 'filled');
  });

  it('shows an empty signature box at a size a finger can hit', () => {
    setup({ fields: [field('s1', 'signature', 'r1', { x: 72, y: 100, width: 40, height: 10 })] });
    const box = screen.getByRole('button', { name: 'Signature, required' });
    expect(parseFloat(box.style.width)).toBeGreaterThanOrEqual(96);
    expect(parseFloat(box.style.height)).toBeGreaterThanOrEqual(36);
  });
});
