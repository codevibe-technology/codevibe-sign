// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionLinks } from './section-links';

type Entry = { isIntersecting: boolean; target: Element };
let report: ((entries: Entry[]) => void) | null = null;

afterEach(() => {
  vi.unstubAllGlobals();
  report = null;
});

describe('SectionLinks', () => {
  it('marks the link for the section in view', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Entry[]) => void) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(
      <>
        <nav>
          <SectionLinks
            links={[
              { label: 'How it works', href: '/#features' },
              { label: 'Pricing', href: '/#pricing' },
            ]}
          />
        </nav>
        <section id="features" />
        <section id="pricing" />
      </>,
    );
    const pricing = screen.getByRole('link', { name: 'Pricing' });
    expect(pricing).toHaveAttribute('href', '/#pricing');
    expect(pricing).not.toHaveAttribute('aria-current');
    act(() => report?.([{ isIntersecting: true, target: document.getElementById('pricing')! }]));
    expect(pricing).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('link', { name: 'How it works' })).not.toHaveAttribute('aria-current');
    act(() => report?.([{ isIntersecting: false, target: document.getElementById('pricing')! }]));
    expect(pricing).not.toHaveAttribute('aria-current');
  });

  it('stays plain links on pages without the sections', () => {
    render(<SectionLinks links={[{ label: 'Pricing', href: '/#pricing' }]} />);
    expect(screen.getByRole('link', { name: 'Pricing' })).not.toHaveAttribute('aria-current');
  });
});
