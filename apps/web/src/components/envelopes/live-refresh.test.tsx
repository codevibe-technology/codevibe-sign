// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { LiveRefresh } = await import('./live-refresh');

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

describe('LiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
    setVisibility('visible');
  });
  afterEach(() => vi.useRealTimers());

  it('refreshes on every interval while the tab is visible', () => {
    render(<LiveRefresh active intervalMs={1000} />);
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('skips refreshes while the tab is hidden and catches up when it shows again', () => {
    render(<LiveRefresh active intervalMs={1000} />);
    setVisibility('hidden');
    vi.advanceTimersByTime(3000);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing when inactive', () => {
    render(<LiveRefresh active={false} intervalMs={1000} />);
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops after unmount', () => {
    const { unmount } = render(<LiveRefresh active intervalMs={1000} />);
    unmount();
    vi.advanceTimersByTime(3000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
