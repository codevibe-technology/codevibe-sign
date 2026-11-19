import { useEffect, useState } from 'react';
import { loadPdf, type LoadPdfOptions } from './pdfjs';
import type { PdfSource, ViewerDocument } from './types';

export interface DocumentState {
  source?: PdfSource;
  error?: Error;
}

/**
 * Resolves each document to a PdfSource: its own `source` when given, otherwise
 * the `file` loaded with pdf.js. Sources loaded here are destroyed on change.
 */
export function usePdfSources(
  documents: ViewerDocument[],
  options?: LoadPdfOptions,
): Record<string, DocumentState> {
  const [loaded, setLoaded] = useState<Record<string, DocumentState>>({});

  useEffect(() => {
    let cancelled = false;
    const owned: PdfSource[] = [];
    for (const doc of documents) {
      if (doc.source || doc.file === undefined) continue;
      loadPdf(doc.file, options).then(
        (source) => {
          if (cancelled) {
            source.destroy?.();
            return;
          }
          owned.push(source);
          setLoaded((prev) => ({ ...prev, [doc.id]: { source } }));
        },
        (error: unknown) => {
          if (cancelled) return;
          const err = error instanceof Error ? error : new Error(String(error));
          setLoaded((prev) => ({ ...prev, [doc.id]: { error: err } }));
        },
      );
    }
    return () => {
      cancelled = true;
      for (const source of owned) source.destroy?.();
      if (owned.length > 0) setLoaded({});
    };
    // Reload only when the set of files changes, not on every render of the array.
  }, [documents.map((d) => `${d.id}:${d.source ? 'source' : fileKey(d.file)}`).join('|')]);

  const result: Record<string, DocumentState> = {};
  for (const doc of documents) {
    result[doc.id] = doc.source ? { source: doc.source } : (loaded[doc.id] ?? {});
  }
  return result;
}

const fileIds = new WeakMap<object, number>();
let nextFileId = 1;

function fileKey(file: ViewerDocument['file']): string {
  if (file === undefined) return 'none';
  if (typeof file === 'string') return file;
  if (file instanceof URL) return file.href;
  let id = fileIds.get(file);
  if (id === undefined) {
    id = nextFileId++;
    fileIds.set(file, id);
  }
  return `bytes#${id}`;
}
