import 'server-only';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.crt': 'application/x-x509-ca-cert',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Where the built docs are: `DOCS_DIR`, or `docs-dist` next to the app. */
export const docsDir = () =>
  resolve(process.env.DOCS_DIR || join(/* turbopackIgnore: true */ process.cwd(), 'docs-dist'));

async function isFile(path: string) {
  try {
    return (await stat(/* turbopackIgnore: true */ path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The file for a docs path, trying it as given, with `.html`, then as a folder's `index.html`,
 * so `/docs/guides/webhooks`, `/docs/guides/webhooks.html` and folder addresses all work.
 * Null for anything outside the docs folder or not there.
 */
export async function resolveDocsFile(root: string, segments: string[]): Promise<string | null> {
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\0'))) {
    return null;
  }
  const base = resolve(root, ...segments);
  if (base !== root && !base.startsWith(root + sep)) return null;
  const candidates =
    segments.length === 0
      ? [join(root, 'index.html')]
      : [base, `${base}.html`, join(base, 'index.html')];
  for (const candidate of candidates) if (await isFile(candidate)) return candidate;
  return null;
}

/**
 * The clean address of a page asked for by its `.html` file, such as `/docs/guides/webhooks`
 * for `guides/webhooks.html`, or null when the address is already clean. Pages are linked
 * without `.html`, so older links land on the one address search engines know.
 */
export function cleanDocsPath(segments: string[]): string | null {
  const last = segments.at(-1);
  if (!last?.endsWith('.html') || (segments.length === 1 && last === '404.html')) return null;
  const page = last.slice(0, -'.html'.length);
  const path = page === 'index' ? segments.slice(0, -1) : [...segments.slice(0, -1), page];
  return ['/docs', ...path].join('/');
}

/**
 * The bytes a `Range: bytes=…` header asks for, as an inclusive `[start, end]`, null when it
 * asks for something else (the whole file is sent then), or `'unsatisfiable'` when it starts
 * past the end. Only a single range is honoured: video players ask for one at a time.
 */
export function byteRange(
  header: string | null | undefined,
  size: number,
): [number, number] | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    return [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return [start, end];
}

/**
 * Serves the built docs site; assets are fingerprinted, so they are cached for a year. A page
 * asked for by its `.html` file is sent on to its clean address, keeping `search`. A `range`
 * header gets the part it asks for, which Safari needs before it plays a video.
 */
export async function serveDocs(
  segments: string[],
  head = false,
  search = '',
  range: string | null = null,
): Promise<Response> {
  const root = docsDir();
  const file = await resolveDocsFile(root, segments);
  const clean = file ? cleanDocsPath(segments) : null;
  if (clean) {
    return new Response(null, {
      status: 308,
      headers: { location: `${clean}${search}`, 'cache-control': 'public, max-age=3600' },
    });
  }
  const notFound = file ? null : join(root, '404.html');
  const path = file ?? notFound!;
  let body: Uint8Array;
  try {
    body = await readFile(/* turbopackIgnore: true */ path);
  } catch {
    return new Response('The documentation is not part of this build.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const immutable = segments[0] === 'assets';
  const headers: Record<string, string> = {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': String(body.byteLength),
    'accept-ranges': 'bytes',
    'cache-control':
      immutable && file
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
  };
  const part = file ? byteRange(range, body.byteLength) : null;
  if (part === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${body.byteLength}`, 'accept-ranges': 'bytes' },
    });
  }
  if (part) {
    const [start, end] = part;
    const slice = body.subarray(start, end + 1);
    return new Response(head ? null : (slice as BodyInit), {
      status: 206,
      headers: {
        ...headers,
        'content-length': String(slice.byteLength),
        'content-range': `bytes ${start}-${end}/${body.byteLength}`,
      },
    });
  }
  return new Response(head ? null : (body as BodyInit), {
    status: file ? 200 : 404,
    headers,
  });
}
