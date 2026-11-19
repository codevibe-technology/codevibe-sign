import { parentPort, workerData } from 'node:worker_threads';
import { constants, inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from 'pdf-lib';
import type { LimitName, ParseLimits } from './limits';

/*
 * The worker thread behind `checkParseLimits`. The build bundles this file together with
 * pdf-lib into one self-contained script that the main thread runs from source, so the check
 * never has to find pdf-lib on disk, even when an application bundler has inlined this package.
 *
 * It inflates every Flate stream with a shared output budget before pdf-lib sees the file
 * (pdf-lib inflates object streams while parsing, with no limit), then parses the file and
 * walks every object for nesting depth, the page tree for depth, cycles and page count.
 */

export type WorkerVerdict =
  | { ok: true }
  | { ok: false; limit: LimitName }
  | { ok: false; cycle: true };

export interface WorkerInput {
  bytes: Uint8Array;
  limits: ParseLimits;
}

function decodedStreamsWithinBudget(bytes: Uint8Array, maxDecodedBytes: number): boolean {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const streamStart = /stream\r?\n/g;
  let budget = maxDecodedBytes;
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
      const inflated = inflateSync(data, {
        maxOutputLength: Math.max(1, budget + 1),
        finishFlush: constants.Z_SYNC_FLUSH,
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

async function inspect({ bytes, limits }: WorkerInput): Promise<WorkerVerdict> {
  const declaredObjects = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString('latin1')
    .match(/\d+\s+\d+\s+obj\b/g);
  if ((declaredObjects?.length ?? 0) > limits.maxObjects) {
    return { ok: false, limit: 'maxObjects' };
  }
  if (!decodedStreamsWithinBudget(bytes, limits.maxDecodedBytes)) {
    return { ok: false, limit: 'maxDecodedBytes' };
  }

  let doc: PDFDocument;
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

const post = (verdict: WorkerVerdict) => parentPort?.postMessage(verdict);
inspect(workerData as WorkerInput).then(post, () => post({ ok: true }));
