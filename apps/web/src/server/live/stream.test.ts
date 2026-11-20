import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeChange } from './events';
import { createLiveHub } from './hub';
import { liveStream } from './stream';

function setup() {
  let onMessage: (payload: string) => void = () => {};
  const hub = createLiveHub(async (_channel, message, ready) => {
    onMessage = message;
    ready();
  });
  const notify = (w: string, e: string) =>
    onMessage(encodeChange({ workspaceId: w, envelopeId: e, actions: ['recipient.viewed'] })!);
  return { hub, notify };
}

async function readSome(response: Response, count: number) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (let i = 0; i < count; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return { text, reader };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('live stream', () => {
  it('answers as an unbuffered event stream', async () => {
    const { hub } = setup();
    const res = await liveStream({
      hub,
      workspaceId: 'ws_a',
      signal: new AbortController().signal,
      stillAllowed: async () => true,
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const { text, reader } = await readSome(res, 2);
    expect(text).toContain('retry: 3000');
    expect(text).toContain('event: ready');
    await reader.cancel();
    expect(hub.size()).toBe(0);
  });

  it("sends its own workspace's changes and never another's", async () => {
    const { hub, notify } = setup();
    const res = await liveStream({
      hub,
      workspaceId: 'ws_a',
      signal: new AbortController().signal,
      stillAllowed: async () => true,
    });
    notify('ws_b', 'env_secret');
    notify('ws_a', 'env_1');
    const { text, reader } = await readSome(res, 3);
    expect(text).toContain(
      'event: change\ndata: {"envelopeId":"env_1","actions":["recipient.viewed"]}',
    );
    expect(text).not.toContain('env_secret');
    expect(text).not.toContain('ws_');
    await reader.cancel();
  });

  it('sends heartbeats and ends once the viewer loses access', async () => {
    vi.useFakeTimers();
    const { hub } = setup();
    let allowed = true;
    const res = await liveStream({
      hub,
      workspaceId: 'ws_a',
      signal: new AbortController().signal,
      stillAllowed: async () => allowed,
      heartbeatMs: 25_000,
    });
    await vi.advanceTimersByTimeAsync(25_000);
    const { text, reader } = await readSome(res, 3);
    expect(text).toContain(': ping');
    allowed = false;
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await reader.read()).done).toBe(true);
    expect(hub.size()).toBe(0);
  });

  it('unsubscribes when the browser disconnects', async () => {
    const { hub } = setup();
    const controller = new AbortController();
    await liveStream({
      hub,
      workspaceId: 'ws_a',
      signal: controller.signal,
      stillAllowed: async () => true,
    });
    expect(hub.size()).toBe(1);
    controller.abort();
    expect(hub.size()).toBe(0);
  });
});
