// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExcludedDocumentNotice } from './excluded-document-notice';

describe('ExcludedDocumentNotice', () => {
  it('opens the legal notes in a new tab, so the envelope being written is not lost', () => {
    render(<ExcludedDocumentNotice names={['power_of_attorney.pdf']} />);
    const link = screen.getByRole('link', { name: 'Read the legal notes (opens in a new tab)' });
    expect(link).toHaveAttribute('href', '/docs/legal');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('stays out of the way for ordinary documents', () => {
    render(<ExcludedDocumentNotice names={['offer-letter.pdf']} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
