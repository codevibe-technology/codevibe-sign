// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordLookup } from './record-lookup';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('RecordLookup', () => {
  beforeEach(() => push.mockReset());

  it('opens the record a pasted link names', async () => {
    render(<RecordLookup />);
    await userEvent.type(
      screen.getByLabelText('Record link'),
      'https://sign.codevibe.in/r/Zk3vQ9xLm2Tn8RbYc4Wd7HsA',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open record' }));
    expect(push).toHaveBeenCalledWith('/r/Zk3vQ9xLm2Tn8RbYc4Wd7HsA');
  });

  it('says what to paste when the text is not a record link', async () => {
    render(<RecordLookup />);
    await userEvent.type(screen.getByLabelText('Record link'), 'https://example.com/verify');
    await userEvent.click(screen.getByRole('button', { name: 'Open record' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Paste the whole link');
    expect(screen.getByLabelText('Record link')).toHaveAttribute('aria-invalid', 'true');
  });
});
