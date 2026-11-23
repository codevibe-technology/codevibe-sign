// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AadhaarPlacementNote } from './aadhaar-note';

describe('AadhaarPlacementNote', () => {
  it('says Leegality places the signature and links to how to set the position', () => {
    render(<AadhaarPlacementNote name="Ravi Kumar" />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(
      "Ravi Kumar signs with Aadhaar eSign. Leegality places the Aadhaar signature where your Leegality workflow says (set the signature position in the workflow). You don't place a box.",
    );
    expect(screen.getByRole('link', { name: 'How to set the position' }).getAttribute('href')).toBe(
      '/docs/guides/aadhaar-leegality#set-the-signature-position',
    );
  });
});
