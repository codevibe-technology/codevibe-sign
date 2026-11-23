// @vitest-environment jsdom
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmoothAnchors, sectionTarget } from './smooth-anchors';

const link = (href: string, attrs: Record<string, string> = {}) => {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  return a;
};

describe('sectionTarget', () => {
  it('finds the section a link points at on this page', () => {
    expect(sectionTarget(link('#pricing'), window.location)).toBe('pricing');
    expect(sectionTarget(link('/#pricing'), window.location)).toBe('pricing');
  });

  it('leaves links that go elsewhere', () => {
    expect(sectionTarget(link('/docs#install'), window.location)).toBeNull();
    expect(sectionTarget(link('https://codevibe.in/#work'), window.location)).toBeNull();
    expect(sectionTarget(link('/'), window.location)).toBeNull();
    expect(sectionTarget(link('#top', { target: '_blank' }), window.location)).toBeNull();
  });
});

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query })),
  );
}

describe('SmoothAnchors', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const page = () =>
    render(
      <>
        <SmoothAnchors />
        <a href="/#pricing">Pricing</a>
        <a href="/docs">Docs</a>
        <section id="pricing">
          <h2>Plans</h2>
        </section>
      </>,
    );

  it('glides to the section, keeps the hash and moves focus to its heading', async () => {
    setReducedMotion(false);
    const { getByText, getByRole } = page();
    await userEvent.click(getByText('Pricing'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(window.location.hash).toBe('#pricing');
    const heading = getByRole('heading', { name: 'Plans' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
  });

  it('jumps without the glide for reduced motion', async () => {
    setReducedMotion(true);
    const { getByText } = page();
    await userEvent.click(getByText('Pricing'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  });

  it('lets other links and modified clicks through', async () => {
    setReducedMotion(false);
    const { getByText } = page();
    const docs = getByText('Docs');
    const clicked = vi.fn((event: MouseEvent) => event.preventDefault());
    docs.addEventListener('click', clicked);
    await userEvent.click(docs);
    expect(scrollIntoView).not.toHaveBeenCalled();
    getByText('Pricing').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
