// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceSignOut, openSessionChannel, type SessionMessage } from './session-sync';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('openSessionChannel', () => {
  it('carries messages between tabs over a BroadcastChannel, never back to the sender', async () => {
    const heard: SessionMessage[] = [];
    const mine: SessionMessage[] = [];
    const other = openSessionChannel((message) => heard.push(message));
    const here = openSessionChannel((message) => mine.push(message));
    here.post({ type: 'activity', at: 42 });
    announceSignOut('idle');
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    expect(heard).toEqual([
      { type: 'activity', at: 42 },
      { type: 'signed-out', reason: 'idle' },
    ]);
    expect(mine).toEqual([{ type: 'signed-out', reason: 'idle' }]);
    other.close();
    here.close();
  });

  it('falls back to storage events where there is no BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const heard: SessionMessage[] = [];
    const channel = openSessionChannel((message) => heard.push(message));
    channel.post({ type: 'activity', at: 7 });
    const written = localStorage.getItem('cvs.session-sync')!;
    expect(JSON.parse(written)).toMatchObject({ type: 'activity', at: 7 });

    // The storage event fires in the other tabs, so play the part of one.
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'cvs.session-sync', newValue: written }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cvs.session-sync',
        newValue: JSON.stringify({ type: 'signed-out', reason: 'chosen' }),
      }),
    );
    expect(heard).toEqual([
      { type: 'activity', at: 7 },
      { type: 'signed-out', reason: 'chosen' },
    ]);
    channel.close();
  });

  it('ignores anything that is not one of its messages', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const heard: SessionMessage[] = [];
    const channel = openSessionChannel((message) => heard.push(message));
    for (const newValue of [
      'not json',
      JSON.stringify({ type: 'activity', at: 'soon' }),
      JSON.stringify({ type: 'signed-out', reason: 'because' }),
      JSON.stringify(null),
    ]) {
      window.dispatchEvent(new StorageEvent('storage', { key: 'cvs.session-sync', newValue }));
    }
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'other',
        newValue: JSON.stringify({ type: 'activity', at: 1 }),
      }),
    );
    expect(heard).toEqual([]);
    channel.close();
  });
});
