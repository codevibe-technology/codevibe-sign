// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: unknown = {}) {
    if (type === 'ready') this.readyState = FakeEventSource.OPEN;
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  fail(closed: boolean) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.();
  }
  static last() {
    return FakeEventSource.all.at(-1)!;
  }
}

const { LiveUpdates } = await import('./live-updates');

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

describe('LiveUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
    FakeEventSource.all = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("subscribes to the workspace's stream and shows Live once connected", () => {
    render(<LiveUpdates workspaceId="ws_1" envelopeId="env_1" />);
    expect(FakeEventSource.last().url).toBe('/api/live/workspaces/ws_1/stream');
    expect(screen.queryByRole('status')).toBeNull();
    act(() => FakeEventSource.last().emit('ready'));
    expect(screen.getByRole('status')).toHaveTextContent('Live');
  });

  it('refreshes once, debounced, for changes to the envelope on screen only', () => {
    render(<LiveUpdates workspaceId="ws_1" envelopeId="env_1" />);
    const source = FakeEventSource.last();
    act(() => {
      source.emit('ready');
      source.emit('change', { envelopeId: 'env_other', actions: ['recipient.signed'] });
    });
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      source.emit('change', { envelopeId: 'env_1', actions: ['recipient.viewed'] });
      source.emit('change', { envelopeId: 'env_1', actions: ['recipient.signed'] });
    });
    vi.advanceTimersByTime(299);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes for any change in the workspace when no envelope is given', () => {
    render(<LiveUpdates workspaceId="ws_1" />);
    act(() => FakeEventSource.last().emit('change', { envelopeId: 'env_9', actions: [] }));
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('waits for a hidden tab to be shown before refreshing', () => {
    render(<LiveUpdates workspaceId="ws_1" />);
    setVisibility('hidden');
    act(() => FakeEventSource.last().emit('change', { envelopeId: 'env_1', actions: [] }));
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows Reconnecting, reopens with growing delays and refreshes after it is back', () => {
    render(<LiveUpdates workspaceId="ws_1" envelopeId="env_1" />);
    act(() => FakeEventSource.last().emit('ready'));
    act(() => FakeEventSource.last().fail(true));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(FakeEventSource.all).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.all).toHaveLength(2);
    act(() => FakeEventSource.last().fail(true));
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.all).toHaveLength(3);
    act(() => FakeEventSource.last().emit('ready'));
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves reconnecting to EventSource while it is still trying', () => {
    render(<LiveUpdates workspaceId="ws_1" />);
    act(() => FakeEventSource.last().fail(false));
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.all).toHaveLength(1);
  });

  it('refreshes on a resync and closes the stream on unmount', () => {
    const { unmount } = render(<LiveUpdates workspaceId="ws_1" envelopeId="env_1" />);
    act(() => FakeEventSource.last().emit('resync'));
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    expect(FakeEventSource.last().readyState).toBe(FakeEventSource.CLOSED);
  });
});
