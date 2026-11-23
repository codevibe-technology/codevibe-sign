// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExternalLink } from './external-link';

describe('ExternalLink', () => {
  it('opens in a new tab without the opener or referrer, and says so', () => {
    render(<ExternalLink href="https://codevibe.in">Codevibe</ExternalLink>);
    const link = screen.getByRole('link', { name: 'Codevibe (opens in a new tab)' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('can leave out the arrow for links drawn as buttons', () => {
    const { container } = render(
      <ExternalLink href="https://github.com" bare>
        GitHub
      </ExternalLink>,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('link')).toHaveAccessibleName('GitHub (opens in a new tab)');
  });
});
