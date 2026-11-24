// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AadhaarPlacementNote } from './aadhaar-note';

describe('AadhaarPlacementNote', () => {
  it('offers the optional seal position and links to how it works', () => {
    render(<AadhaarPlacementNote name="Ravi Kumar" />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Ravi Kumar signs with Aadhaar eSign. Leegality places the Aadhaar signature where your Leegality workflow says. To choose the spot, place the optional Aadhaar seal position on the page.',
    );
    expect(screen.getByRole('link', { name: 'How the position works' }).getAttribute('href')).toBe(
      '/docs/guides/aadhaar-leegality#choose-where-the-signature-goes',
    );
  });

  it('says the signature goes in the box once one is placed', () => {
    render(<AadhaarPlacementNote placed supported />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Leegality draws the Aadhaar signature in the Aadhaar seal position you placed. Nothing else is added to the file, and the signer fills in nothing.',
    );
  });

  it('says a placed box is not used when the account has no V4 workflow', () => {
    render(<AadhaarPlacementNote placed supported={false} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      /You placed an Aadhaar seal position, but the Leegality account in use has no V4 workflow/,
    );
  });

  it('asks for no box when the account cannot place one', () => {
    render(<AadhaarPlacementNote supported={false} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      "Leegality places the Aadhaar signature where your Leegality workflow says (set the signature position in the workflow). You don't place a box.",
    );
  });
});
