import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

/** Rules for the URLs the server may deliver webhooks to. */
export interface WebhookSecurity {
  /**
   * Allow `http://` URLs, bare IP hosts and private, loopback and link-local addresses. For
   * local development against a receiver on your machine only; never in production.
   */
  allowInsecure?: boolean;
  /**
   * Host names webhooks may go to: `hooks.example.com` matches that host exactly,
   * `.example.com` matches any host under it. When set, every other host is refused, and a host
   * on the list is trusted wherever it resolves (so it can be an internal service).
   */
  allowHosts?: string[];
  /** Resolves a host name to its addresses. Defaults to the system resolver. */
  lookup?: (hostname: string) => Promise<string[]>;
}

export class WebhookAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookAddressError';
  }
}

type Range = [prefix: number[], bits: number];

const IPV4_BLOCKED: Range[] = [
  [[0], 8],
  [[10], 8],
  [[100, 64], 10],
  [[127], 8],
  [[169, 254], 16],
  [[172, 16], 12],
  [[192, 0, 0], 24],
  [[192, 0, 2], 24],
  [[192, 88, 99], 24],
  [[192, 168], 16],
  [[198, 18], 15],
  [[198, 51, 100], 24],
  [[203, 0, 113], 24],
  [[224], 4],
  [[240], 4],
];

const IPV6_BLOCKED: Range[] = [
  [[], 128],
  [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 128],
  [[0x00, 0x64, 0xff, 0x9b], 96],
  [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48],
  [[0x01, 0x00], 64],
  [[0x20, 0x01, 0x00, 0x00], 32],
  [[0x20, 0x01, 0x0d, 0xb8], 32],
  [[0x20, 0x02], 16],
  [[0xfc], 7],
  [[0xfe, 0x80], 10],
  [[0xfe, 0xc0], 10],
  [[0xff], 8],
  // IPv4-translated (::ffff:0:a.b.c.d), which a translator turns back into an IPv4 address.
  [[0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0], 96],
];

function inRange(bytes: number[], [prefix, bits]: Range): boolean {
  for (let bit = 0; bit < bits; bit++) {
    const index = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if (((bytes[index] ?? 0) & mask) !== ((prefix[index] ?? 0) & mask)) return false;
  }
  return true;
}

function ipv4Bytes(ip: string): number[] {
  return ip.split('.').map(Number);
}

function ipv6Bytes(ip: string): number[] {
  let text = ip.replace(/^\[|\]$/g, '').split('%')[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const [a, b, c, d] = ipv4Bytes(dotted[1]) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [(value >> 8) & 0xff, value & 0xff];
  });
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip.replace(/^\[|\]$/g, '').split('%')[0]!);
  if (version === 4) {
    const bytes = ipv4Bytes(ip);
    return !IPV4_BLOCKED.some((range) => inRange(bytes, range));
  }
  if (version !== 6) return false;
  const bytes = ipv6Bytes(ip);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses reach IPv4 hosts.
  const mapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible =
    bytes.slice(0, 12).every((b) => b === 0) && bytes.slice(12).some((b) => b !== 0);
  if (mapped || (compatible && !inRange(bytes, IPV6_BLOCKED[1]!))) {
    return isPublicAddress(bytes.slice(12).join('.'));
  }
  return !IPV6_BLOCKED.some((range) => inRange(bytes, range));
}

function hostAllowed(hostname: string, allowHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowHosts.some((entry) => {
    const rule = entry.toLowerCase();
    return rule.startsWith('.') ? host.endsWith(rule) && host.length > rule.length : host === rule;
  });
}

/**
 * Checks a webhook URL before anything is resolved: https only, no credentials, no
 * privileged port other than 443, no bare IP host, and on the allow-list when there is one.
 * Run it when targets are configured and again before each delivery.
 */
export function checkWebhookUrl(raw: string, security: WebhookSecurity = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookAddressError('Webhook URL is not a valid URL');
  }
  const insecure = security.allowInsecure ?? false;
  const listed = security.allowHosts ? hostAllowed(url.hostname, security.allowHosts) : false;
  if (url.protocol !== 'https:' && !(insecure && url.protocol === 'http:')) {
    throw new WebhookAddressError('Webhook URL must use https');
  }
  if (url.username || url.password) {
    throw new WebhookAddressError('Webhook URL must not contain credentials');
  }
  const port = url.port ? Number(url.port) : undefined;
  if (port !== undefined && port < 1024 && port !== 443 && !insecure) {
    throw new WebhookAddressError('Webhook URL must not use a privileged port other than 443');
  }
  if (security.allowHosts && !listed) {
    throw new WebhookAddressError('Webhook host is not on the allow-list');
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !listed && !insecure) {
    throw new WebhookAddressError('Webhook URL must use a host name, not an IP address');
  }
  return url;
}

const systemLookup = async (hostname: string) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Resolves the URL's host and returns the address to connect to. Every address the name
 * resolves to must be public, so a second answer cannot point the request inside.
 */
export async function resolveWebhookAddress(
  url: URL,
  security: WebhookSecurity = {},
): Promise<string> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [hostname]
    : await (security.lookup ?? systemLookup)(hostname).catch(() => []);
  const first = addresses[0];
  if (!first) throw new WebhookAddressError('Webhook host does not resolve');
  const trusted =
    security.allowInsecure ||
    (security.allowHosts !== undefined && hostAllowed(url.hostname, security.allowHosts));
  if (!trusted && !addresses.every(isPublicAddress)) {
    throw new WebhookAddressError('Webhook host resolves to a private or reserved address');
  }
  return first;
}

export interface PinnedRequest {
  url: URL;
  address: string;
  headers: Record<string, string>;
  body: string;
  connectTimeoutMs: number;
  totalTimeoutMs: number;
  maxResponseBytes: number;
}

/**
 * POSTs to `url` over a connection made to `address`, which was already checked, so DNS is not
 * consulted again. Redirects are not followed; at most `maxResponseBytes` of the response are
 * read and the rest discarded. Resolves with the status code.
 */
export function pinnedPost(options: PinnedRequest): Promise<number> {
  const { url, address } = options;
  const family = isIP(address);
  const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if ((lookupOptions as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address, family },
      ]);
    } else {
      callback(null, address, family);
    }
  };
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, status?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      clearTimeout(connect);
      if (error) reject(error);
      else resolve(status ?? 0);
    };
    const req = send(
      url,
      {
        method: 'POST',
        headers: { ...options.headers, 'content-length': String(Buffer.byteLength(options.body)) },
        lookup,
        agent: false,
      },
      (res: IncomingMessage) => {
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > options.maxResponseBytes) res.destroy();
        });
        res.on('close', () => finish(null, res.statusCode));
        res.on('error', () => finish(null, res.statusCode));
      },
    );
    const total = setTimeout(() => {
      req.destroy(new Error('Webhook request timed out'));
    }, options.totalTimeoutMs);
    const connect = setTimeout(() => {
      req.destroy(new Error('Webhook connection timed out'));
    }, options.connectTimeoutMs);
    req.on('socket', (socket) => {
      socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () =>
        clearTimeout(connect),
      );
    });
    req.on('error', (error) => finish(error));
    req.end(options.body);
  });
}
