import type { LiveHub, LiveSignal } from './hub';

export const HEARTBEAT_MS = 25_000;
/** How long the browser waits before reconnecting after the stream drops. */
export const RETRY_MS = 3_000;

export const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // `no-transform` keeps compression from buffering the stream.
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Tells nginx-style proxies not to buffer.
  'X-Accel-Buffering': 'no',
} as const;

export interface LiveStreamOptions {
  hub: LiveHub;
  workspaceId: string;
  /** Aborted when the browser goes away. */
  signal: AbortSignal;
  /** Asked on every heartbeat; the stream ends once the viewer has lost access. */
  stillAllowed: () => Promise<boolean>;
  heartbeatMs?: number;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function frameFor(signal: LiveSignal): string {
  if (signal.type === 'resync') return frame('resync', {});
  const { envelopeId, actions } = signal.change;
  return frame('change', { envelopeId, actions });
}

/**
 * A Server-Sent Events response carrying one workspace's envelope changes. Sends a comment
 * every heartbeat so proxies keep the connection open, and unsubscribes when it closes.
 */
export async function liveStream(options: LiveStreamOptions): Promise<Response> {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const subscription: { off?: () => void } = {};

  const write = (text: string) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      close();
    }
  };

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    subscription.off?.();
    options.signal.removeEventListener('abort', close);
    try {
      controller.close();
    } catch {
      // Already closed by the reader.
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      close();
    },
  });

  subscription.off = await options.hub.subscribe(options.workspaceId, (signal) =>
    write(frameFor(signal)),
  );
  if (closed) {
    subscription.off();
  } else if (options.signal.aborted) {
    close();
  } else {
    options.signal.addEventListener('abort', close);
    write(`retry: ${RETRY_MS}\n\n`);
    write(frame('ready', {}));
    timer = setInterval(() => {
      options
        .stillAllowed()
        .then((allowed) => (allowed ? write(': ping\n\n') : close()))
        .catch(() => write(': ping\n\n'));
    }, options.heartbeatMs ?? HEARTBEAT_MS);
  }

  return new Response(body, { headers: STREAM_HEADERS });
}
