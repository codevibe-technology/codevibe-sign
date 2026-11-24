// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onBeforeSignOut } from '@/lib/before-sign-out';
import type { SessionChannel, SessionMessage } from '@/lib/session-sync';

vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

const { IdleSignOut } = await import('./idle-sign-out');

/** One end of a channel to a pretend second tab: what this tab posts, and a way to talk to it. */
function otherTab() {
  const posted: SessionMessage[] = [];
  let deliver: (message: SessionMessage) => void = () => undefined;
  const connect = (onMessage: (message: SessionMessage) => void): SessionChannel => {
    deliver = onMessage;
    return { post: (message) => void posted.push(message), close: () => undefined };
  };
  return { posted, connect, say: (message: SessionMessage) => act(() => deliver(message)) };
}

const IDLE = 30 * 60;
const WARNING = 120;
const TOUCH = 60;

function setup(overrides: { touch?: () => Promise<boolean> } = {}) {
  const tab = otherTab();
  const calls: string[] = [];
  const signOut = vi.fn(async () => void calls.push('signOut'));
  const navigate = vi.fn((url: string) => void calls.push(`navigate:${url}`));
  const touch = vi.fn(overrides.touch ?? (async () => true));
  render(
    <IdleSignOut
      idleSeconds={IDLE}
      warningSeconds={WARNING}
      touchSeconds={TOUCH}
      signOut={signOut}
      navigate={navigate}
      touch={touch}
      channel={tab.connect}
    />,
  );
  return { tab, calls, signOut, navigate, touch };
}

const pass = async (seconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  window.history.pushState({}, '', '/dashboard/acme/envelopes?view=sent');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('IdleSignOut', () => {
  it('warns two minutes before, counts down, then signs out and comes back here', async () => {
    const { calls, signOut } = setup();
    await pass(IDLE - WARNING - 1);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await pass(1);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('You’ll be signed out in 2:00 for your security');
    expect(screen.getByRole('button', { name: 'Stay signed in' })).toHaveFocus();

    await pass(61);
    expect(dialog).toHaveTextContent('0:59');
    await pass(59);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'signOut',
      `navigate:/sign-in?reason=idle&next=${encodeURIComponent('/dashboard/acme/envelopes?view=sent')}`,
    ]);
  });

  it('starts again from any use of the page before the warning', async () => {
    const { signOut } = setup();
    await pass(IDLE - WARNING - 10);
    fireEvent.keyDown(window, { key: 'a' });
    await pass(IDLE - WARNING - 1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.pointerDown(document.body);
    await pass(IDLE - 1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('keeps the warning up when the mouse merely moves, until someone chooses', async () => {
    const { signOut, touch } = setup();
    await pass(IDLE - WARNING);
    touch.mockClear();
    fireEvent.pointerMove(window);
    fireEvent.keyDown(window, { key: 'Shift' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(touch).toHaveBeenCalledTimes(1);
    await pass(IDLE - WARNING - 1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('treats Escape as staying', async () => {
    setup();
    await pass(IDLE - WARNING);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('signs out at once on "Sign out", without the idle notice', async () => {
    const { calls, tab } = setup();
    await pass(IDLE - WARNING);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await pass(0);
    expect(calls).toEqual([
      'signOut',
      `navigate:/sign-in?next=${encodeURIComponent('/dashboard/acme/envelopes?view=sent')}`,
    ]);
    expect(tab.posted).toContainEqual({ type: 'signed-out', reason: 'chosen' });
  });

  it('saves pending work before signing out', async () => {
    const order: string[] = [];
    const remove = onBeforeSignOut(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push('saved');
    });
    const { signOut } = setup();
    signOut.mockImplementation(async () => void order.push('signOut'));
    await pass(IDLE + 1);
    expect(order).toEqual(['saved', 'signOut']);
    remove();
  });

  it('signs out after a sleep longer than the limit, the moment the page is seen again', async () => {
    const { signOut } = setup();
    vi.setSystemTime(Date.now() + (IDLE + 60) * 1000);
    fireEvent(document, new Event('visibilitychange'));
    await pass(0);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('tells the server about activity at most once a minute, and the last of it too', async () => {
    const { touch } = setup();
    await pass(TOUCH + 2);
    fireEvent.keyDown(window, { key: 'a' });
    expect(touch).toHaveBeenCalledTimes(1);
    await pass(5);
    fireEvent.keyDown(window, { key: 'b' });
    fireEvent.pointerDown(window);
    expect(touch).toHaveBeenCalledTimes(1);
    await pass(TOUCH);
    expect(touch).toHaveBeenCalledTimes(2);
    await pass(TOUCH * 3);
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it('follows the server when it has ended the session', async () => {
    const { navigate } = setup({ touch: async () => false });
    await pass(TOUCH + 2);
    fireEvent.keyDown(window, { key: 'a' });
    await pass(0);
    expect(navigate).toHaveBeenCalledWith(
      `/sign-in?reason=ended&next=${encodeURIComponent('/dashboard/acme/envelopes?view=sent')}`,
    );
  });
});

describe('IdleSignOut across tabs', () => {
  it('stays signed in while another tab is in use', async () => {
    const { tab, signOut } = setup();
    await pass(IDLE - WARNING - 5);
    tab.say({ type: 'activity', at: Date.now() });
    await pass(IDLE - WARNING - 1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('closes its warning when someone chooses to stay in another tab', async () => {
    const { tab } = setup();
    await pass(IDLE - WARNING + 10);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    tab.say({ type: 'activity', at: Date.now() });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('tells the other tabs about its own activity, a few seconds apart at most', async () => {
    const { tab } = setup();
    await pass(10);
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'b' });
    expect(tab.posted.filter((m) => m.type === 'activity')).toHaveLength(1);
    await pass(6);
    fireEvent.keyDown(window, { key: 'c' });
    expect(tab.posted.filter((m) => m.type === 'activity')).toHaveLength(2);
  });

  it('follows a sign-out in another tab without signing out again', async () => {
    const { tab, signOut, navigate } = setup();
    tab.say({ type: 'signed-out', reason: 'idle' });
    await pass(0);
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/sign-in\?reason=idle&next=/));
  });

  it('ignores news older than what it already knows', async () => {
    const { tab } = setup();
    await pass(IDLE - WARNING);
    tab.say({ type: 'activity', at: Date.now() - IDLE * 1000 });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
