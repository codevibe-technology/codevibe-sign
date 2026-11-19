import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import type * as WorkerThreads from 'node:worker_threads';
import type * as Zlib from 'node:zlib';
import type * as PdfLib from 'pdf-lib';
import { SignError } from '@codevibe_technology/sign-core';

/** Bounds on the work one PDF may cost to read. */
export interface ParseLimits {
  /** Most pages. Default 500. */
  maxPages: number;
  /** Most indirect objects. Default 100 000. */
  maxObjects: number;
  /** Deepest nesting of arrays and dictionaries, and of the page tree. Default 64. */
  maxDepth: number;
  /** Most bytes all compressed streams may inflate to, together. Default 50 MB. */
  maxDecodedBytes: number;
  /** Wall-clock budget for reading the file; the worker is killed after it. Default 10 s. */
  timeoutMs: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  maxPages: 500,
  maxObjects: 100_000,
  maxDepth: 64,
  maxDecodedBytes: 50 * 1024 * 1024,
  timeoutMs: 10_000,
};

/** Heap for the inspection worker; a file that needs more is refused. */
const WORKER_HEAP_MB = 512;

type LimitName = Exclude<keyof ParseLimits, 'timeoutMs'>;

type WorkerVerdict = { ok: true } | { ok: false; limit: LimitName } | { ok: false; cycle: true };

interface WorkerInput {
  pdfLib: string;
  bytes: Uint8Array;
  limits: ParseLimits;
}

/**
 * Runs inside the worker, from its source text, so it may use only its argument and globals.
 * It inflates every Flate stream with a shared output budget before pdf-lib sees the file
 * (pdf-lib inflates object streams while parsing, with no limit), then parses the file and
 * walks every object for nesting depth, the page tree for depth, cycles and page count.
 */
function inspectInWorker(load: (id: string) => unknown): void {
  const threads = load('node:worker_threads') as typeof WorkerThreads;
  const zlib = load('node:zlib') as typeof Zlib;
  const input = threads.workerData as WorkerInput;
  const lib = load(input.pdfLib) as typeof PdfLib;
  const { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } = lib;
  const { bytes, limits } = input;
  const post = (verdict: WorkerVerdict) => threads.parentPort?.postMessage(verdict);

  function decodedStreamsWithinBudget(): boolean {
    const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
    const streamStart = /stream\r?\n/g;
    let budget = limits.maxDecodedBytes;
    for (let match = streamStart.exec(text); match; match = streamStart.exec(text)) {
      const dictionaryStart = text.lastIndexOf('obj', match.index);
      const dictionary = text.slice(Math.max(0, dictionaryStart), match.index);
      if (!/\/FlateDecode/.test(dictionary) || !/>>\s*$/.test(dictionary)) {
        continue;
      }
      const dataStart = match.index + match[0].length;
      const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary);
      const end = text.indexOf('endstream', dataStart);
      const length = declared ? Number(declared[1]) : (end === -1 ? text.length : end) - dataStart;
      const data = bytes.subarray(dataStart, Math.min(bytes.byteLength, dataStart + length));
      try {
        const inflated = zlib.inflateSync(data, {
          maxOutputLength: Math.max(1, budget + 1),
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        });
        budget -= inflated.byteLength;
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
          return false;
        }
      }
      if (budget < 0) {
        return false;
      }
      streamStart.lastIndex = end === -1 ? text.length : end + 'endstream'.length;
    }
    return true;
  }

  function nestingWithin(root: unknown, maxDepth: number): boolean {
    const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 1 }];
    while (stack.length > 0) {
      const { value, depth } = stack.pop()!;
      if (depth > maxDepth) {
        return false;
      }
      if (value instanceof PDFStream) {
        stack.push({ value: value.dict, depth });
      } else if (value instanceof PDFDict) {
        for (const [, entry] of value.entries()) stack.push({ value: entry, depth: depth + 1 });
      } else if (value instanceof PDFArray) {
        for (const entry of value.asArray()) stack.push({ value: entry, depth: depth + 1 });
      }
    }
    return true;
  }

  async function run(): Promise<WorkerVerdict> {
    const declaredObjects = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .toString('latin1')
      .match(/\d+\s+\d+\s+obj\b/g);
    if ((declaredObjects?.length ?? 0) > limits.maxObjects) {
      return { ok: false, limit: 'maxObjects' };
    }
    if (!decodedStreamsWithinBudget()) {
      return { ok: false, limit: 'maxDecodedBytes' };
    }

    let doc: PdfLib.PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch {
      // Unreadable files are reported by the regular loader, which knows why.
      return { ok: true };
    }
    const objects = doc.context.enumerateIndirectObjects();
    if (objects.length > limits.maxObjects) {
      return { ok: false, limit: 'maxObjects' };
    }
    for (const [, object] of objects) {
      if (!nestingWithin(object, limits.maxDepth)) {
        return { ok: false, limit: 'maxDepth' };
      }
    }

    const pagesRef = doc.catalog.get(PDFName.of('Pages'));
    const seen = new Set<unknown>();
    const stack: { node: unknown; depth: number }[] = [{ node: pagesRef, depth: 1 }];
    let pages = 0;
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (depth > limits.maxDepth) {
        return { ok: false, limit: 'maxDepth' };
      }
      if (node instanceof PDFRef) {
        if (seen.has(node.tag)) {
          return { ok: false, cycle: true };
        }
        seen.add(node.tag);
      }
      const dict = node instanceof PDFRef ? doc.context.lookup(node) : node;
      if (!(dict instanceof PDFDict)) {
        continue;
      }
      const kids = dict.get(PDFName.of('Kids'));
      const list = kids instanceof PDFRef ? doc.context.lookup(kids) : kids;
      if (list instanceof PDFArray) {
        for (const kid of list.asArray()) stack.push({ node: kid, depth: depth + 1 });
      } else {
        pages += 1;
        if (pages > limits.maxPages) {
          return { ok: false, limit: 'maxPages' };
        }
      }
    }
    return { ok: true };
  }

  run().then(post, () => post({ ok: true }));
}

const LIMIT_MESSAGES: Record<LimitName, (max: number) => string> = {
  maxPages: (max) => `The PDF has more than ${max} pages.`,
  maxObjects: (max) => `The PDF has more than ${max} objects.`,
  maxDepth: (max) => `The PDF nests objects more than ${max} levels deep.`,
  maxDecodedBytes: (max) => `The PDF's compressed content expands to more than ${max} bytes.`,
};

function limitError(limit: LimitName, max: number): SignError {
  return new SignError('DOCUMENT_INVALID', `${LIMIT_MESSAGES[limit](max)} It cannot be used.`, {
    reason: 'limit',
    limit,
    max,
  });
}

function resolvePdfLib(): string {
  return createRequire(import.meta.url).resolve('pdf-lib');
}

/**
 * Reads the file in a worker thread under `limits` and throws `DOCUMENT_INVALID` when it goes
 * over one, runs out of time (the worker is terminated) or exhausts the worker's memory. A file
 * that passes can then be parsed on the main thread at a bounded cost.
 */
export async function checkParseLimits(
  bytes: Uint8Array,
  overrides: Partial<ParseLimits> = {},
): Promise<void> {
  const limits: ParseLimits = { ...DEFAULT_PARSE_LIMITS, ...overrides };
  const input: WorkerInput = { pdfLib: resolvePdfLib(), bytes, limits };
  const worker = new Worker(`(${inspectInWorker.toString()})(require)`, {
    eval: true,
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  });

  const verdict = await new Promise<WorkerVerdict | 'timeout' | 'crashed'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), limits.timeoutMs);
    const finish = (value: WorkerVerdict | 'crashed') => {
      clearTimeout(timer);
      resolve(value);
    };
    worker.once('message', (message: WorkerVerdict) => finish(message));
    worker.once('error', () => finish('crashed'));
    worker.once('exit', () => finish('crashed'));
  });
  await worker.terminate();

  if (verdict === 'timeout') {
    throw new SignError(
      'DOCUMENT_INVALID',
      `The PDF took longer than ${limits.timeoutMs} ms to read. It cannot be used.`,
      { reason: 'timeout', timeoutMs: limits.timeoutMs },
    );
  }
  if (verdict === 'crashed') {
    throw new SignError('DOCUMENT_INVALID', 'The PDF needs too much memory to read.', {
      reason: 'limit',
      limit: 'memory',
    });
  }
  if (!verdict.ok) {
    if ('cycle' in verdict) {
      throw new SignError('DOCUMENT_INVALID', 'The PDF could not be read. It may be damaged.', {
        reason: 'unreadable',
      });
    }
    throw limitError(verdict.limit, limits[verdict.limit]);
  }
}
