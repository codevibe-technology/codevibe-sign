// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reveal } from './reveal';
import { RevealOnScroll } from './reveal-on-scroll';

type Callback = (entries: { isIntersecting: boolean; target: Element }[]) => void;

describe('RevealOnScroll', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks a block shown once it comes into view, and only then', () => {
    let notify: Callback = () => {};
    const unobserve = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: Callback) {
          notify = callback;
        }
        observe() {}
        unobserve = unobserve;
        disconnect() {}
      },
    );
    const { container, unmount } = render(
      <>
        <RevealOnScroll />
        <div {...reveal()}>first</div>
        <div {...reveal(2)}>second</div>
      </>,
    );
    const [first, second] = container.querySelectorAll('[data-reveal]');
    expect(document.documentElement.hasAttribute('data-reveal-ready')).toBe(true);
    expect((second as HTMLElement).style.getPropertyValue('--reveal-order')).toBe('2');
    notify([
      { isIntersecting: true, target: first! },
      { isIntersecting: false, target: second! },
    ]);
    expect(first!.hasAttribute('data-shown')).toBe(true);
    expect(second!.hasAttribute('data-shown')).toBe(false);
    expect(unobserve).toHaveBeenCalledWith(first);
    unmount();
    expect(document.documentElement.hasAttribute('data-reveal-ready')).toBe(false);
  });

  it('hides nothing where the browser cannot tell what is in view', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<RevealOnScroll />);
    expect(document.documentElement.hasAttribute('data-reveal-ready')).toBe(false);
  });
});
