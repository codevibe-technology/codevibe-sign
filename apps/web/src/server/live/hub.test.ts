import { describe, expect, it, vi } from 'vitest';
import { LIVE_CHANNEL, encodeChange } from './events';
import { createLiveHub, type LiveSignal } from './hub';

function fakeListener() {
  let onMessage: ((payload: string) => void) | undefined;
  let onListen: (() => void) | undefined;
  const listen = vi.fn(async (channel: string, message: (p: string) => void, ready: () => void) => {
    expect(channel).toBe(LIVE_CHANNEL);
    onMessage = message;
    onListen = ready;
    ready();
  });
  return {
    listen,
    notify: (w: string, e: string, a = ['recipient.signed']) =>
      onMessage?.(encodeChange({ workspaceId: w, envelopeId: e, actions: a })!),
    raw: (payload: string) => onMessage?.(payload),
    relisten: () => onListen?.(),
  };
}

describe('live hub', () => {
  it('delivers a change only to subscribers of its own workspace', async () => {
    const pg = fakeListener();
    const hub = createLiveHub(pg.listen);
    const acme: LiveSignal[] = [];
    const other: LiveSignal[] = [];
    await hub.subscribe('ws_acme', (s) => acme.push(s));
    await hub.subscribe('ws_other', (s) => other.push(s));
    pg.notify('ws_acme', 'env_1');
    pg.notify('ws_third', 'env_2');
    expect(acme).toEqual([
      {
        type: 'change',
        change: { workspaceId: 'ws_acme', envelopeId: 'env_1', actions: ['recipient.signed'] },
      },
    ]);
    expect(other).toEqual([]);
  });

  it('shares one listener between every subscriber', async () => {
    const pg = fakeListener();
    const hub = createLiveHub(pg.listen);
    await Promise.all([hub.subscribe('ws_a', () => {}), hub.subscribe('ws_b', () => {})]);
    await hub.subscribe('ws_a', () => {});
    expect(pg.listen).toHaveBeenCalledTimes(1);
    expect(hub.size()).toBe(3);
  });

  it('stops delivering after unsubscribe', async () => {
    const pg = fakeListener();
    const hub = createLiveHub(pg.listen);
    const seen: LiveSignal[] = [];
    const off = await hub.subscribe('ws_a', (s) => seen.push(s));
    off();
    off();
    pg.notify('ws_a', 'env_1');
    expect(seen).toEqual([]);
    expect(hub.size()).toBe(0);
  });

  it('tells everyone to resync after the listener reconnects', async () => {
    const pg = fakeListener();
    const hub = createLiveHub(pg.listen);
    const seen: LiveSignal[] = [];
    await hub.subscribe('ws_a', (s) => seen.push(s));
    pg.relisten();
    expect(seen).toEqual([{ type: 'resync' }]);
  });

  it('ignores malformed payloads and keeps going when one subscriber throws', async () => {
    const pg = fakeListener();
    const hub = createLiveHub(pg.listen);
    const seen: LiveSignal[] = [];
    await hub.subscribe('ws_a', () => {
      throw new Error('stream gone');
    });
    await hub.subscribe('ws_a', (s) => seen.push(s));
    pg.raw('{"w":"ws_a"}');
    pg.notify('ws_a', 'env_1');
    expect(seen).toHaveLength(1);
  });

  it('tries to listen again after a failed start', async () => {
    const listen = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce(undefined);
    const hub = createLiveHub(listen);
    await expect(hub.subscribe('ws_a', () => {})).rejects.toThrow('database down');
    await expect(hub.subscribe('ws_a', () => {})).resolves.toBeTypeOf('function');
    expect(listen).toHaveBeenCalledTimes(2);
  });
});
