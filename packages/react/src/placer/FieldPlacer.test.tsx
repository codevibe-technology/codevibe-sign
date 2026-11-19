import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { Field } from '@codevibe_technology/sign-core';
import { letterSource, recipient } from '../test/fixtures';
import { FieldPlacer } from './FieldPlacer';
import { useFieldPlacement } from './useFieldPlacement';

const recipients = [recipient('r1', 'Asha Rao', 1), recipient('r2', 'Vikram Shah', 2)];
// jsdom has no layout, so the viewer falls back to an 800px wide column.
const scale = 800 / 612;

function setup(props: Partial<Parameters<typeof FieldPlacer>[0]> = {}) {
  let ids = 0;
  const onChange = vi.fn<(fields: Field[]) => void>();
  render(
    <FieldPlacer
      documents={[{ id: 'doc', name: 'Offer', source: letterSource(2) }]}
      recipients={recipients}
      onChange={onChange}
      createId={() => `f${++ids}`}
      {...props}
    />,
  );
  const last = () => onChange.mock.calls.at(-1)![0];
  return { onChange, last };
}

describe('FieldPlacer', () => {
  it('adds a field to the page in view from the keyboard', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Signature' }));
    expect(last()).toEqual([
      {
        id: 'f1',
        documentId: 'doc',
        recipientId: 'r1',
        type: 'signature',
        page: 0,
        rect: { x: 216, y: 369, width: 180, height: 54 },
        required: true,
      },
    ]);
    const placed = screen.getByRole('button', { name: 'Signature for Asha Rao, page 1' });
    expect(placed).toHaveStyle({ left: `${216 * scale}px`, width: `${180 * scale}px` });
  });

  it('converts a drop position on the page to points', () => {
    const { last } = setup();
    const page = screen.getAllByRole('group', { name: /Page 2 of 2/ })[0]!;
    page.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: 800,
        height: 792 * scale,
        right: 900,
        bottom: 0,
        x: 100,
        y: 50,
      }) as DOMRect;
    document.elementsFromPoint = () => [page];

    const item = screen.getByRole('button', { name: 'Initials' });
    fireEvent.pointerDown(item, { pointerId: 3, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(item, { pointerId: 3, clientX: 500, clientY: 250 });
    fireEvent.pointerUp(item, { pointerId: 3, clientX: 500, clientY: 250 });
    fireEvent.click(item);

    const fields = last();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ page: 1, type: 'initials' });
    // Centre at (400px, 200px) on the page = (306pt, 153pt); initials are 72 x 40.
    expect(fields[0]!.rect).toEqual({ x: 270, y: 133, width: 72, height: 40 });
  });

  it('moves a field by dragging, converting pixels to points', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const placed = screen.getByRole('button', { name: /^Text for Asha Rao/ });
    fireEvent.pointerDown(placed, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(placed, { pointerId: 1, clientX: 80, clientY: -40 });
    fireEvent.pointerUp(placed, { pointerId: 1, clientX: 80, clientY: -40 });
    const rect = last()[0]!.rect;
    expect(rect.x).toBeCloseTo(226 + 80 / scale, 1);
    expect(rect.y).toBeCloseTo(385 - 40 / scale, 1);
  });

  it('snaps a dragged field to the page edge', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const placed = screen.getByRole('button', { name: /^Text for Asha Rao/ });
    // 226pt from the left edge; drag to 3pt from it.
    const dx = -(226 - 3) * scale;
    fireEvent.pointerDown(placed, { pointerId: 1, clientX: 500, clientY: 0, button: 0 });
    fireEvent.pointerMove(placed, { pointerId: 1, clientX: 500 + dx, clientY: 0 });
    expect(last()[0]!.rect.x).toBe(0);
  });

  it('resizes from the corner handle', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Signature' }));
    const handle = document.querySelector('.cvs-placed-resize')!;
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 20 * scale, clientY: -40 * scale });
    expect(last()[0]!.rect).toMatchObject({ width: 200, height: 14 });
  });

  it('nudges, resizes and deletes with the keyboard', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Signature' }));
    const placed = screen.getByRole('button', { name: /^Signature for Asha Rao/ });
    placed.focus();

    fireEvent.keyDown(placed, { key: 'ArrowRight' });
    expect(last()[0]!.rect).toEqual({ x: 217, y: 369, width: 180, height: 54 });
    fireEvent.keyDown(placed, { key: 'ArrowDown', shiftKey: true });
    expect(last()[0]!.rect).toEqual({ x: 217, y: 379, width: 180, height: 54 });
    fireEvent.keyDown(placed, { key: 'ArrowLeft', altKey: true });
    expect(last()[0]!.rect).toEqual({ x: 217, y: 379, width: 179, height: 54 });
    fireEvent.keyDown(placed, { key: 'Delete' });
    expect(last()).toEqual([]);
  });

  it('assigns fields to recipients with their own colour', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Vikram Shah' }));
    fireEvent.click(screen.getByRole('button', { name: 'Date signed' }));
    expect(last()[0]).toMatchObject({ recipientId: 'r2', type: 'date_signed' });
    const placed = screen.getByRole('button', { name: /^Date signed for Vikram Shah/ });
    expect(placed).toHaveAttribute('data-cvs-color', '1');

    const inspector = screen.getByRole('group', { name: 'Selected field' });
    fireEvent.change(within(inspector).getByLabelText('Assigned to'), { target: { value: 'r1' } });
    fireEvent.click(within(inspector).getByLabelText('Required'));
    expect(last()[0]).toMatchObject({ recipientId: 'r1', required: false });
    expect(screen.getByRole('button', { name: /^Date signed for Asha Rao/ })).toHaveAttribute(
      'data-cvs-color',
      '0',
    );
  });

  it('leaves viewers out and explains when nobody can sign', () => {
    render(
      <FieldPlacer
        documents={[{ id: 'doc', source: letterSource(1) }]}
        recipients={[{ ...recipient('v', 'Viewer'), role: 'viewer' }]}
      />,
    );
    expect(screen.getByText('Add a recipient to start placing fields.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Signature' })).toBeDisabled();
  });
});

describe('useFieldPlacement', () => {
  const pageSizes = { doc: [{ width: 612, height: 792 }] };

  it('reports changes without owning state when controlled', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useFieldPlacement({ fields: [], onChange, pageSizes, recipients, createId: () => 'x' }),
    );
    act(() => {
      result.current.addField('checkbox', 'doc', 0, { x: 0, y: 0 });
    });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'x',
        rect: { x: 0, y: 0, width: 18, height: 18 },
        required: false,
      }),
    ]);
    expect(result.current.fields).toEqual([]);
  });

  it('ignores pages it does not know', () => {
    const { result } = renderHook(() => useFieldPlacement({ pageSizes, recipients }));
    act(() => {
      expect(result.current.addField('text', 'doc', 4)).toBeNull();
    });
    expect(result.current.fields).toEqual([]);
  });
});
