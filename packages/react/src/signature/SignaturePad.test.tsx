import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { checkFieldValue } from '@codevibe_technology/sign-core';
import { paperCanvas } from '../test/canvas';
import { SignaturePad } from './SignaturePad';

afterEach(() => {
  vi.unstubAllGlobals();
});

function drawLine(canvas: HTMLElement) {
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100, x: 0, y: 0 }) as DOMRect;
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    pointerType: 'pen',
    pressure: 0.7,
    clientX: 20,
    clientY: 50,
    button: 0,
  });
  for (let x = 30; x <= 200; x += 10) {
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      pointerType: 'pen',
      pressure: 0.7,
      clientX: x,
      clientY: 50 + (x % 20),
    });
  }
  fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen', clientX: 200, clientY: 50 });
}

describe('SignaturePad', () => {
  it('switches modes with clicks and arrow keys', async () => {
    const user = userEvent.setup();
    render(<SignaturePad />);
    const draw = screen.getByRole('tab', { name: 'Draw' });
    expect(draw).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'Signature drawing area' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Type' }));
    expect(screen.getByRole('tab', { name: 'Type' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Type' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Upload' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Upload' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Upload' }), { key: 'ArrowRight' });
    expect(draw).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(draw, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Upload' })).toHaveAttribute('aria-selected', 'true');
  });

  it('reports a PNG when a stroke is drawn, and null after undo', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    drawLine(screen.getByRole('img', { name: 'Signature drawing area' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const png = onChange.mock.calls[0]![0] as string;
    expect(checkFieldValue('signature', png).ok).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('ignores secondary mouse buttons', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Signature drawing area' });
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 2,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a typed name in the chosen style and colour', async () => {
    const onChange = vi.fn();
    render(
      <SignaturePad
        onChange={onChange}
        defaultMode="type"
        fonts={[
          { label: 'Hand', family: 'cursive' },
          { label: 'Book', family: 'serif' },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha Rao' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(checkFieldValue('signature', onChange.mock.calls.at(-1)![0] as string).ok).toBe(true);

    const book = screen.getByRole('radio', { name: 'Book' });
    fireEvent.click(book);
    expect(book).toHaveAttribute('aria-checked', 'true');
    expect(book).toHaveStyle({ fontFamily: 'serif' });

    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: '   ' } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(null));
  });

  it('re-encodes an uploaded image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => paperCanvas(300, 120, { x: 40, y: 40, width: 200, height: 30 })),
    );
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} defaultMode="upload" />);
    const input = screen.getByLabelText('Choose an image', { selector: 'input' });
    const file = new File([new Uint8Array(500)], 'signature.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const png = onChange.mock.calls[0]![0] as string;
    expect(checkFieldValue('signature', png).ok).toBe(true);
    expect(screen.getByRole('img', { name: 'Current signature' })).toHaveAttribute(
      'src',
      `data:image/png;base64,${png}`,
    );
  });

  it('explains a rejected upload', async () => {
    render(<SignaturePad defaultMode="upload" />);
    const input = screen.getByLabelText('Choose an image', { selector: 'input' });
    const file = new File(['<svg/>'], 'sig.svg', { type: 'image/svg+xml' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG or WebP image.');
  });

  it('shows an existing value and keeps it when switching to an empty tab', () => {
    const onChange = vi.fn();
    render(<SignaturePad value="QUJD" onChange={onChange} />);
    expect(screen.getByRole('img', { name: 'Current signature' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Upload' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('accepts translated labels', () => {
    render(<SignaturePad labels={{ draw: 'Dessiner', type: 'Écrire', upload: 'Importer' }} />);
    expect(screen.getByRole('tab', { name: 'Dessiner' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Importer' })).toBeInTheDocument();
  });
});
